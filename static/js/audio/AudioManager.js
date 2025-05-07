/**
 * 音频管理模块 - 处理录音、播放和音频资源
 */
class AudioManager {
    constructor() {
        this.audioContext = null;
        this.mediaRecorder = null;
        this.mediaStream = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.recordingTimeout = null;
        this.MAX_RECORDING_TIME = 30000; // 最长录音30秒
    }
    
    /**
     * 初始化音频系统
     */
    async initialize() {
        try {
            // 创建音频上下文
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // 请求麦克风权限
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true, // 回声消除
                    noiseSuppression: true, // 噪音抑制
                    autoGainControl: true   // 自动增益控制
                } 
            });
            
            // 确定支持的音频格式
            let mimeType = 'audio/wav';
            if (!MediaRecorder.isTypeSupported('audio/wav')) {
                if (MediaRecorder.isTypeSupported('audio/webm')) {
                    mimeType = 'audio/webm';
                } else {
                    mimeType = ''; // 使用默认格式
                }
            }
            
            // 创建媒体录制器
            this.mediaRecorder = new MediaRecorder(this.mediaStream, {
                mimeType: mimeType || undefined
            });
            
            console.log("音频系统初始化完成，使用格式:", this.mediaRecorder.mimeType);
            
            return this.mediaRecorder.mimeType;
        } catch (error) {
            console.error('初始化音频失败:', error);
            throw error;
        }
    }
    
    /**
     * 配置录音事件监听
     * @param {Function} onDataAvailable - 数据可用时的回调
     */
    setupRecordingEvents(onDataAvailable) {
        // 设置录音数据处理
        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                this.audioChunks.push(event.data);
                if (onDataAvailable) onDataAvailable(event.data);
            }
        };
    }
    
    /**
     * 创建音频分析器节点
     * @returns {AnalyserNode} 音频分析器
     */
    createAnalyser() {
        if (!this.audioContext || !this.mediaStream) return null;
        
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 256; // FFT大小
        analyser.smoothingTimeConstant = 0.5; // 平滑系数
        
        const source = this.audioContext.createMediaStreamSource(this.mediaStream);
        source.connect(analyser);
        
        return analyser;
    }
    
    /**
     * 开始录音
     * @param {Function} onTimeout - 录音超时回调
     */
    startRecording(onTimeout) {
        if (this.isRecording) return;
        
        // 清空之前的音频数据
        this.audioChunks = [];
        
        try {
            // 确保MediaRecorder可用
            if (this.mediaRecorder && this.mediaRecorder.state !== 'recording') {
                this.mediaRecorder.start(100); // 每100ms触发一次事件
                this.isRecording = true;
                console.log('开始录音');
                
                // 更新UI
                const voiceButton = document.getElementById('voice-button');
                if (voiceButton) voiceButton.classList.add('recording');
                
                // 设置录音超时保护
                clearTimeout(this.recordingTimeout);
                this.recordingTimeout = setTimeout(() => {
                    console.log("录音超时（最长30秒），自动处理");
                    if (this.isRecording && onTimeout) {
                        onTimeout();
                    }
                }, this.MAX_RECORDING_TIME);
            }
        } catch (error) {
            console.error('开始录音失败:', error);
            this.isRecording = false;
        }
    }
    
    /**
     * 停止录音
     */
    stopRecording() {
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
    
    /**
     * 获取录音数据并转换为Blob
     */
    getRecordingBlob() {
        if (this.audioChunks.length === 0) return null;
        
        const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        
        return audioBlob;
    }
    
    /**
     * 清空录音数据
     */
    clearRecording() {
        this.audioChunks = [];
    }
    
    /**
     * 将Blob转换为Base64格式
     */
    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
    
    /**
     * 播放音频数据块
     * @param {string} base64Data - Base64编码的音频数据
     */
    playAudioChunk(base64Data) {
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
    
    /**
     * 清理音频资源
     */
    async cleanup() {
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
        this.isRecording = false;
        clearTimeout(this.recordingTimeout);
    }
}

export default AudioManager;
