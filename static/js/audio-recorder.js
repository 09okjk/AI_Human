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
     * 开始录音
     * @param {AudioContext} audioContext - 音频上下文
     * @returns {Promise<void>}
     */
    async startRecording(audioContext) {
        try {
            if (!audioContext) {
                throw new Error("音频上下文未初始化");
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
            
            // 开始录音
            this.mediaRecorder.start();
            this.isRecording = true;
            
            this.setStatus("正在录音...");
            return true;
        } catch (error) {
            console.error("开始录音时出错:", error);
            this.setStatus("无法访问麦克风");
            return false;
        }
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
     * 获取录音状态
     * @returns {boolean} - 是否正在录音
     */
    getIsRecording() {
        return this.isRecording;
    }
}

// 导出模块
export default AudioRecorder;
