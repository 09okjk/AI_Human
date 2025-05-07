/**
 * 语音活动检测模块 - 检测用户是否在说话
 */
class VoiceDetection {
    constructor() {
        this.lastAudioLevel = 0;
        this.speakingThreshold = 0.015; // 说话阈值
        this.consecutiveSilentFrames = 0; // 连续静音帧数
        this.consecutiveSpeakingFrames = 0; // 连续说话帧数
        this.silenceTimer = null;
        this.silenceTimeout = 1800; // 静音1.8秒认为停止说话
        this.vadAnimationFrame = null; // VAD动画帧
        this.isActive = false; // 检测是否活跃
    }
    
    /**
     * 开始语音活动检测
     * @param {AnalyserNode} analyser - 音频分析器节点
     * @param {Function} onSpeechStart - 检测到开始说话时的回调
     * @param {Function} onSpeechEnd - 检测到停止说话时的回调
     * @param {Function} onSilenceTimeout - 静音超时时的回调
     * @param {Function} onUpdateIndicator - 更新指示器的回调
     */
    start(analyser, onSpeechStart, onSpeechEnd, onSilenceTimeout, onUpdateIndicator) {
        if (!analyser) return;
        this.isActive = true;
        
        // 设置数据缓冲区
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        // 清除之前的计时器
        this.cancelAllTimers();
        
        // 定义音频分析函数
        const analyzeAudio = () => {
            // 如果检测已停止，不继续处理
            if (!this.isActive) {
                console.log("语音检测已停止");
                return;
            }
            
            // 获取频域数据
            analyser.getByteFrequencyData(dataArray);
            
            // 计算人声频率范围的能量 (300Hz-3400Hz)
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
                    this.handleSpeaking(onSpeechStart);
                }
            } else {
                this.consecutiveSilentFrames++;
                this.consecutiveSpeakingFrames = 0;
                
                // 需要连续10帧以上检测不到声音才确认为静音
                if (this.consecutiveSilentFrames >= 10) {
                    this.handleSilence(onSpeechEnd, onSilenceTimeout);
                }
            }
            
            // 更新录音指示器
            if (onUpdateIndicator) {
                onUpdateIndicator(this.consecutiveSpeakingFrames >= 3);
            }
            
            // 继续检测
            this.vadAnimationFrame = requestAnimationFrame(analyzeAudio);
        };
        
        // 开始音频分析
        this.vadAnimationFrame = requestAnimationFrame(analyzeAudio);
    }
    
    /**
     * 处理检测到用户正在说话的情况
     * @param {Function} onSpeechStart - 说话开始回调
     */
    handleSpeaking(onSpeechStart) {
        // 清除静音计时器
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
        
        // 触发说话开始回调
        if (onSpeechStart) {
            onSpeechStart(this.lastAudioLevel);
        }
    }
    
    /**
     * 处理检测到用户停止说话的情况
     * @param {Function} onSpeechEnd - 说话结束回调
     * @param {Function} onSilenceTimeout - 静音超时回调
     */
    handleSilence(onSpeechEnd, onSilenceTimeout) {
        // 如果已经有静音计时器，不需要重复设置
        if (this.silenceTimer) return;
        
        // 触发说话结束回调
        if (onSpeechEnd) {
            onSpeechEnd();
        }
        
        // 设置静音计时器，如果持续静音超过阈值，则认为用户说话结束
        this.silenceTimer = setTimeout(() => {
            if (onSilenceTimeout && this.isActive) {
                onSilenceTimeout();
            }
            this.silenceTimer = null;
        }, this.silenceTimeout);
    }
    
    /**
     * 停止语音检测
     */
    stop() {
        this.isActive = false;
        this.cancelAllTimers();
    }
    
    /**
     * 取消所有计时器
     */
    cancelAllTimers() {
        // 取消动画帧
        if (this.vadAnimationFrame) {
            cancelAnimationFrame(this.vadAnimationFrame);
            this.vadAnimationFrame = null;
        }
        
        // 取消静音计时器
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
    }
    
    /**
     * 获取当前音频电平
     * @returns {number} 0-1之间的音频电平值
     */
    getAudioLevel() {
        return this.lastAudioLevel;
    }
}

export default VoiceDetection;
