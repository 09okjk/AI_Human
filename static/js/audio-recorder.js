/**
 * 音频录制模块
 * 负责麦克风访问和录音功能
 */

class AudioRecorder {
    constructor(statusElement) {
        this.microphone = null;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.statusElement = statusElement;
        this.audioContext = null;
        this.onAudioLevelCallback = null;
        this.onRecordingCompleteCallback = null;
    }

    /**
     * 设置状态消息
     * @param {string} message - 状态消息
     */
    setStatus(message) {
        if (this.statusElement) {
            this.statusElement.textContent = message;
        }
    }

    /**
     * 开始录音 - 兼容语音通话接口
     * @param {Function} onComplete - 录音完成时的回调函数
     * @param {Function} onAudioLevel - 音频电平回调函数
     * @returns {Promise<Boolean>}
     */
    async startRecording(onComplete = null, onAudioLevel = null) {
        try {
            // 保存回调函数
            this.onRecordingCompleteCallback = onComplete;
            this.onAudioLevelCallback = onAudioLevel;
            
            // 创建音频上下文（如果不存在）
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            // 请求麦克风访问
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.microphone = stream;
            
            // 设置媒体录制器
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];
            
            // 监听数据可用事件
            this.mediaRecorder.addEventListener('dataavailable', event => {
                this.audioChunks.push(event.data);
            });
            
            // 设置录音结束事件
            this.mediaRecorder.addEventListener('stop', () => {
                // 创建音频blob
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
                
                // 如果有回调函数，调用它
                if (this.onRecordingCompleteCallback) {
                    this.onRecordingCompleteCallback(audioBlob);
                }
                
                // 清空音频块
                this.audioChunks = [];
            });
            
            // 开始录音
            this.mediaRecorder.start();
            this.isRecording = true;
            
            // 设置音频电平分析器
            if (this.onAudioLevelCallback) {
                this.setupAudioAnalyzer(stream);
            }
            
            this.setStatus("正在录音...");
            return true;
        } catch (error) {
            console.error("开始录音时出错:", error);
            this.setStatus("无法访问麦克风");
            return false;
        }
    }
    
    /**
     * 设置音频分析器
     * @param {MediaStream} stream - 媒体流
     */
    setupAudioAnalyzer(stream) {
        if (!this.audioContext) return;
        
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 256;
        
        const source = this.audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        // 定期分析音频并调用回调
        const analyzeAudio = () => {
            if (!this.isRecording) return;
            
            analyser.getByteFrequencyData(dataArray);
            
            // 计算平均音频电平 (0-1)
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const average = sum / (dataArray.length * 255);
            
            // 调用回调
            if (this.onAudioLevelCallback) {
                this.onAudioLevelCallback(average);
            }
            
            // 继续分析
            requestAnimationFrame(analyzeAudio);
        };
        
        analyzeAudio();
    }
    
    /**
     * 停止录音
     * @returns {Promise<string|null>} - Base64编码的音频数据
     */
    stopRecording() {
        if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
            return Promise.resolve(null);
        }
        
        return new Promise(resolve => {
            this.mediaRecorder.addEventListener('stop', async () => {
                // 从音频块创建音频Blob
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
                
                // 转换为base64
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = () => {
                    const base64Audio = reader.result;
                    resolve(base64Audio);
                };
                
                // 释放麦克风
                if (this.microphone) {
                    this.microphone.getTracks().forEach(track => track.stop());
                }
            });
            
            // 停止录音
            this.mediaRecorder.stop();
            this.isRecording = false;
            this.setStatus("录音已完成");
        });
    }

    /**
     * 处理音频并发送到服务器
     * @param {Blob} audioBlob - 音频数据
     * @param {string} sessionId - 会话ID
     * @returns {Promise<Object>} - 服务器响应
     */
    async processAudioAndSend(audioBlob, sessionId) {
        try {
            // 转换为base64
            const base64Audio = await this.blobToBase64(audioBlob);
            
            // 发送请求
            const response = await fetch('/api/voice-chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    audio: base64Audio,
                    session_id: sessionId
                })
            });
            
            if (!response.ok) {
                throw new Error(`服务器响应错误: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error("处理音频失败:", error);
            throw error;
        }
    }
    
    /**
     * 将Blob转换为Base64格式
     * @param {Blob} blob - 音频blob
     * @returns {Promise<string>} - Base64字符串
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
     * 处理服务器响应
     * @param {Object} response - 服务器响应对象
     */
    handleResponse(response) {
        console.log("处理服务器响应:", response);
        
        // 如果响应包含onComplete回调，在播放完成后调用
        if (response.onComplete) {
            const originalOnComplete = response.onComplete;
            setTimeout(originalOnComplete, 500);
        }
    }
    
    /**
     * 播放AI响应
     * @param {Object} response - AI响应对象
     * @param {Function} onFirstChunk - 收到第一个音频块的回调
     */
    playAiResponse(response, onFirstChunk) {
        console.log("播放AI响应");
        
        // 如果有onFirstChunk回调，调用它
        if (typeof onFirstChunk === 'function') {
            setTimeout(onFirstChunk, 100);
        }
        
        // 这里可以添加音频播放代码
        // ...
    }

    /**
     * 获取录音状态
     * @returns {boolean} - 是否正在录音
     */
    getIsRecording() {
        return this.isRecording;
    }
}

// 导出模块
export default AudioRecorder;
