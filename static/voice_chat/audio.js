/**
 * 语音通话音频处理模块
 * 处理音频录制、分析和播放功能
 */

// 初始化音频系统
async function initAudioSystem() {
    try {
        // 1. 创建音频上下文
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // 2. 请求麦克风权限
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true, // 回声消除
                noiseSuppression: true, // 噪音抑制
                autoGainControl: true   // 自动增益控制
            } 
        });
        
        // 3. 确定支持的音频格式
        let mimeType = 'audio/wav';
        if (!MediaRecorder.isTypeSupported('audio/wav')) {
            if (MediaRecorder.isTypeSupported('audio/webm')) {
                mimeType = 'audio/webm';
            } else {
                mimeType = ''; // 使用默认格式
            }
        }
        
        // 4. 创建媒体录制器
        this.mediaRecorder = new MediaRecorder(this.mediaStream, {
            mimeType: mimeType || undefined
        });
        
        // 5. 设置录音数据处理
        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                this.audioChunks.push(event.data);
            }
        };
        
        console.log("音频系统初始化完成，使用格式:", this.mediaRecorder.mimeType);
        
    } catch (error) {
        console.error('初始化音频失败:', error);
        throw error;
    }
}

// 开始语音检测
function startVoiceDetection() {
    if (!this.audioContext || !this.mediaStream) return;
    
    try {
        // 1. 创建分析节点
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 256; // FFT大小
        analyser.smoothingTimeConstant = 0.5; // 平滑系数，减少波动
        
        // 2. 连接媒体源到分析节点
        const source = this.audioContext.createMediaStreamSource(this.mediaStream);
        source.connect(analyser);
        
        // 3. 设置数据缓冲区
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        // 4. 定义音频分析函数
        const analyzeAudio = () => {
            // 如果通话已结束，停止检测
            if (!this.isCallActive) {
                console.log("通话已结束，停止语音检测");
                return;
            }
            
            // 获取频域数据
            analyser.getByteFrequencyData(dataArray);
            
            // 计算人声频率范围的能量 (300Hz-3400Hz)
            // 对WebAudio API的frequencyBinCount来说，这大致对应于数组的前30%到70%
            let sumEnergy = 0;
            const lowerBin = Math.floor(bufferLength * 0.1);  // ~300Hz
            const upperBin = Math.floor(bufferLength * 0.7);  // ~3400Hz
            
            for (let i = lowerBin; i < upperBin; i++) {
                sumEnergy += dataArray[i];
            }
            
            // 归一化能量值 (0-1)
            const energyLevel = sumEnergy / ((upperBin - lowerBin) * 255);
            this.lastAudioLevel = energyLevel;
            
            // 使用门限检测和滞后处理判断是否在说话
            const isSpeakingNow = energyLevel > this.speakingThreshold;
            
            if (isSpeakingNow) {
                this.consecutiveSpeakingFrames++;
                this.consecutiveSilentFrames = 0;
                
                // 需要连续3帧以上检测到声音才确认为说话
                if (this.consecutiveSpeakingFrames >= 3) {
                    this.handleSpeaking();
                }
            } else {
                this.consecutiveSilentFrames++;
                this.consecutiveSpeakingFrames = 0;
                
                // 需要连续10帧以上检测不到声音才确认为静音
                if (this.consecutiveSilentFrames >= 10) {
                    this.handleSilence();
                }
            }
            
            // 更新录音指示器
            this.updateRecordingIndicator(this.consecutiveSpeakingFrames >= 3);
            
            // 继续检测
            this.vadAnimationFrame = requestAnimationFrame(analyzeAudio);
        };
        
        // 5. 开始音频分析
        this.vadAnimationFrame = requestAnimationFrame(analyzeAudio);
        
    } catch (error) {
        console.error("启动语音检测失败:", error);
    }
}

// 处理检测到用户正在说话的情况
function handleSpeaking() {
    // 清除静音计时器
    if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
    }
    
    // 如果AI正在说话，发送打断信号
    if (this.isAiSpeaking) {
        this.interruptAIResponse();
    }
    
    // 确保录音已经开始
    if (!this.isRecording && this.isCallActive) {
        this.startRecording();
    }
    
    // 更新UI显示
    this.updateStatus('正在说话...');
}

// 处理检测到用户停止说话的情况
function handleSilence() {
    // 如果没有在录音，则不需处理
    if (!this.isRecording) return;
    
    // 如果已经有静音计时器，不需要重复设置
    if (this.silenceTimer) return;
    
    // 显示等待状态
    this.updateStatus('检测到语音停止，等待中...');
    
    // 设置静音计时器，如果持续静音超过阈值，则认为用户说话结束
    this.silenceTimer = setTimeout(() => {
        // 如果有录音数据且通话仍然活跃，则处理录音
        if (this.audioChunks.length > 0 && this.isCallActive) {
            console.log("检测到用户停止说话，处理录音数据");
            this.processRecording();
        }
        this.silenceTimer = null;
    }, this.silenceTimeout);
}

// 停止语音检测
function stopVoiceDetection() {
    if (this.vadAnimationFrame) {
        cancelAnimationFrame(this.vadAnimationFrame);
        this.vadAnimationFrame = null;
    }
}

// 开始录音
function startRecording() {
    // 如果已经在录音或通话不活跃，不执行操作
    if (this.isRecording || !this.isCallActive) return;
    
    try {
        // 清空之前的录音数据
        this.audioChunks = [];
        
        // 确保MediaRecorder可用
        if (this.mediaRecorder && this.mediaRecorder.state !== 'recording') {
            // 开始录音，每100ms获取一次数据
            this.mediaRecorder.start(100);
            this.isRecording = true;
            console.log('开始录音');
            
            // 更新UI显示录音状态
            const voiceButton = document.getElementById('voice-button');
            if (voiceButton) voiceButton.classList.add('recording');
            
            // 设置录音超时保护，防止录音时间过长
            this.recordingTimeout = setTimeout(() => {
                console.log("录音超时（最长30秒），自动处理");
                if (this.isRecording) {
                    this.processRecording();
                }
            }, this.MAX_RECORDING_TIME);
        }
    } catch (error) {
        console.error('开始录音失败:', error);
        this.isRecording = false;
    }
}

// 停止录音
function stopRecording() {
    // 如果没有在录音，不执行操作
    if (!this.isRecording) return;
    
    try {
        // 清除录音超时保护
        clearTimeout(this.recordingTimeout);
        
        // 停止录音
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
            console.log('停止录音');
            
            // 更新UI
            const voiceButton = document.getElementById('voice-button');
            if (voiceButton) voiceButton.classList.remove('recording');
        }
        
        // 更新录音状态
        this.isRecording = false;
    } catch (error) {
        console.error('停止录音失败:', error);
        this.isRecording = false;
    }
}

// 处理录音数据
async function processRecording() {
    // 防止重复处理
    if (!this.isCallActive) return;
    
    try {
        // 停止当前录音
        this.stopRecording();
        this.updateStatus('处理音频中...');
        
        // 如果没有录音数据，直接返回
        if (this.audioChunks.length === 0) {
            console.log("没有录音数据，跳过处理");
            return;
        }
        
        // 获取录音MIME类型
        const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
        
        // 创建录音Blob
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        
        // 检查录音大小，避免处理太小的噪声
        if (audioBlob.size < 1000) {
            console.log("录音数据过小，可能只是噪声，跳过处理", audioBlob.size);
            this.audioChunks = [];
            
            // 重新开始录音
            if (this.isCallActive) {
                setTimeout(() => this.startRecording(), 100);
            }
            return;
        }
        
        // 转换为base64格式
        console.log("转换音频为base64格式...");
        const base64Audio = await this.blobToBase64(audioBlob);
        
        // 发送到服务器
        console.log("发送音频到服务器...");
        await this.sendAudioToServer(base64Audio);
        
        // 清空录音数据
        this.audioChunks = [];
        
    } catch (error) {
        console.error('处理录音失败:', error);
        this.updateStatus('处理录音失败: ' + error.message);
    } finally {
        // 如果通话仍在进行，延迟一会重新开始录音
        if (this.isCallActive) {
            setTimeout(() => {
                if (this.isCallActive && !this.isRecording) {
                    this.startRecording();
                }
            }, 300);
        }
    }
}

// 将Blob转换为Base64格式
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// 播放音频数据块
function playAudioChunk(base64Data) {
    try {
        // 清理base64前缀
        const base64Audio = base64Data.replace(/^data:audio\/[^;]+;base64,/, '');
        
        // 解码base64
        const audioData = atob(base64Audio);
        
        // 转换为Uint8Array
        const uint8Array = new Uint8Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
            uint8Array[i] = audioData.charCodeAt(i);
        }
        
        // 创建Blob和临时URL
        const blob = new Blob([uint8Array], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(blob);
        
        // 创建并播放音频
        const audio = new Audio(audioUrl);
        audio.onended = () => URL.revokeObjectURL(audioUrl);
        audio.play().catch(err => console.error('播放音频失败:', err));
        
    } catch (error) {
        console.error('处理音频数据失败:', error);
    }
}

// 清理音频资源
async function cleanupAudio() {
    console.log("正在清理音频资源...");
    
    // 清理媒体录制器
    if (this.mediaRecorder) {
        try {
            if (this.mediaRecorder.state === 'recording') {
                this.mediaRecorder.stop();
            }
        } catch (e) {
            console.warn("停止录音时出错:", e);
        }
        this.mediaRecorder = null;
    }
    
    // 停止并释放所有媒体轨道
    if (this.mediaStream) {
        try {
            const tracks = this.mediaStream.getTracks();
            tracks.forEach(track => {
                track.stop();
            });
            this.mediaStream = null;
            console.log("媒体轨道已停止");
        } catch (e) {
            console.warn("停止媒体轨道时出错:", e);
        }
    }
    
    // 关闭音频上下文
    if (this.audioContext) {
        try {
            await this.audioContext.close();
            this.audioContext = null;
            console.log("音频上下文已关闭");
        } catch (e) {
            console.warn("关闭音频上下文时出错:", e);
        }
    }
    
    // 清空音频数据
    this.audioChunks = [];
}

// 导出音频处理相关函数
export default {
    initAudioSystem,
    startVoiceDetection,
    handleSpeaking,
    handleSilence,
    stopVoiceDetection,
    startRecording,
    stopRecording,
    processRecording,
    blobToBase64,
    playAudioChunk,
    cleanupAudio
};
