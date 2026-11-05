//! 提示音：系统默认、用户上传、语音播报。
//! 所有播放都在独立的 audio 线程里排队进行，不阻塞调度线程。
//! 音频设备只在播放时打开，播完就释放；语音引擎第一次用到时才创建。

use std::fs::File;
use std::io::{BufReader, Cursor};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::thread;
use std::time::{Duration, Instant};

use rodio::Source;

use crate::engine::config::SoundMode;

/// 上传文件最大 5 MB，播放最长 10 秒（防止误传整首歌）
pub const MAX_UPLOAD_BYTES: usize = 5 * 1024 * 1024;
const MAX_PLAY: Duration = Duration::from_secs(10);
const MAX_SPEAK: Duration = Duration::from_secs(15);

pub struct Job {
    pub mode: SoundMode,
    /// 自定义音频的完整路径
    pub file: Option<PathBuf>,
    /// 语音播报的文字
    pub text: String,
    /// 0.0–1.0
    pub volume: f32,
}

pub struct Audio {
    tx: Sender<Job>,
}

impl Audio {
    pub fn start() -> Self {
        let (tx, rx) = channel::<Job>();
        thread::Builder::new()
            .name("audio".into())
            .spawn(move || {
                let mut voice: Option<tts::Tts> = None;
                for job in rx {
                    if let Err(e) = play(&job, &mut voice) {
                        eprintln!("[audio] 播放失败：{e}");
                    }
                }
            })
            .expect("创建 audio 线程");
        Audio { tx }
    }

    pub fn play(&self, job: Job) {
        let _ = self.tx.send(job);
    }
}

fn play(job: &Job, voice: &mut Option<tts::Tts>) -> Result<(), String> {
    match job.mode {
        SoundMode::Off => Ok(()),
        SoundMode::System => play_file(&system_sound().ok_or("找不到 Windows 系统提示音")?, job.volume),
        SoundMode::Custom => {
            let f = job.file.as_deref().ok_or("还没有上传提示音文件")?;
            // 自定义文件坏了或被删了，退回系统提示音，保证一定有声音
            play_file(f, job.volume).or_else(|e| {
                eprintln!("[audio] 自定义提示音不可用（{e}），改用系统提示音");
                play_file(&system_sound().ok_or("找不到 Windows 系统提示音")?, job.volume)
            })
        }
        SoundMode::Alarm => play_file(&alarm_sound().or_else(system_sound).ok_or("找不到 Windows 闹钟铃声")?, job.volume),
        SoundMode::Voice => speak(&job.text, job.volume, voice).or_else(|e| {
            eprintln!("[audio] 语音播报不可用（{e}），改用系统提示音");
            play_file(&system_sound().ok_or("找不到 Windows 系统提示音")?, job.volume)
        }),
    }
}

/// Windows 自带的通知提示音，按优先级找第一个存在的文件。
fn system_sound() -> Option<PathBuf> {
    let root = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    ["Windows Notify System Generic.wav", "Windows Notify.wav", "notify.wav", "chimes.wav"]
        .iter()
        .map(|f| root.join("Media").join(f))
        .find(|p| p.exists())
}

/// Windows 自带的闹钟铃声（比通知音更醒目），没有就退回系统提示音。
fn alarm_sound() -> Option<PathBuf> {
    let root = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    ["Alarm01.wav", "Alarm02.wav", "Windows Notify Calendar.wav", "Ring01.wav"]
        .iter()
        .map(|f| root.join("Media").join(f))
        .find(|p| p.exists())
}

fn play_file(path: &Path, volume: f32) -> Result<(), String> {
    let (_stream, handle) = rodio::OutputStream::try_default().map_err(|e| format!("打开音频设备失败：{e}"))?;
    let sink = rodio::Sink::try_new(&handle).map_err(|e| e.to_string())?;
    let file = File::open(path).map_err(|e| format!("打开 {} 失败：{e}", path.display()))?;
    let source = rodio::Decoder::new(BufReader::new(file)).map_err(|e| format!("无法解码音频：{e}"))?;
    sink.set_volume(volume);
    sink.append(source.take_duration(MAX_PLAY));
    sink.sleep_until_end();
    Ok(())
}

/// 检查上传的数据能否被解码，返回时长描述（用于界面提示）。
pub fn validate(bytes: &[u8]) -> Result<(), String> {
    rodio::Decoder::new(Cursor::new(bytes.to_vec()))
        .map(|_| ())
        .map_err(|_| "无法识别这个音频文件，请使用 WAV、MP3、OGG 或 FLAC".to_string())
}

fn speak(text: &str, volume: f32, voice: &mut Option<tts::Tts>) -> Result<(), String> {
    if voice.is_none() {
        let mut t = tts::Tts::default().map_err(|e| format!("语音引擎初始化失败：{e}"))?;
        // 优先使用中文语音（Windows 中文版自带“慧慧”“晓晓”等）
        if t.supported_features().voice {
            if let Ok(list) = t.voices() {
                if let Some(v) = list.iter().find(|v| v.language().as_str().to_lowercase().starts_with("zh")) {
                    let _ = t.set_voice(v);
                }
            }
        }
        *voice = Some(t);
    }
    let t = voice.as_mut().expect("刚刚创建");
    let f = t.supported_features();
    if f.volume {
        let v = t.min_volume() + (t.max_volume() - t.min_volume()) * volume;
        let _ = t.set_volume(v);
    }
    t.speak(text, true).map_err(|e| format!("语音播报失败：{e}"))?;

    // 等读完再处理下一条，避免两条播报互相打断
    let start = Instant::now();
    thread::sleep(Duration::from_millis(400));
    if f.is_speaking {
        while t.is_speaking().unwrap_or(false) && start.elapsed() < MAX_SPEAK {
            thread::sleep(Duration::from_millis(100));
        }
    } else {
        thread::sleep(Duration::from_secs(3));
    }
    Ok(())
}
