/**
 * 流式音频播放系统
 * 处理音频流式接收和播放
 */

class AudioStreamingSystem {
    constructor(statusElement) {
        // 音频片段队列
        this.audioQueue = [];
        // 是否正在处理音频
        this.isProcessing = false;
        // 是否正在播放
        this.isPlaying = false;
        // 是否有新片段等待处理
        this.hasNewChunks = false;
        // 当前播放位置
        this.playbackPosition = 0;
        // 累积的音频数据
        this.accumulatedSamples = null;
        // Web Audio API 节点
        this.audioNodes = {};
        // 音频上下文
        this.audioContext = null;
        // 采样率(QWen-Omni固定输出为24000Hz)
        this.sampleRate = 24000;
        // 状态元素引用
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
     * 重置系统
     */
    reset() {
        this.audioQueue = [];
        this.isProcessing = false;
        this.isPlaying = false;
        this.hasNewChunks = false;
        this.playbackPosition = 0;
        this.accumulatedSamples = null;
    }

    /**
     * 初始化音频系统
     * @param {AudioContext} context - 音频上下文
     */
    init(context) {
        this.audioContext = context;
        this.audioNodes = {};
        this.reset();
    }

    /**
     * 添加新的音频片段到队列
     * @param {string} base64Data - Base64编码的音频数据
     */
    addAudioChunk(base64Data) {
        // 移除可能的前缀
        if (base64Data.startsWith('data:audio/wav;base64,')) {
            base64Data = base64Data.substring('data:audio/wav;base64,'.length);
        }
        
        // 将新片段放入队列
        this.audioQueue.push(base64Data);
        this.hasNewChunks = true;
        
        // 如果不在处理中，开始处理
        if (!this.isProcessing) {
            this.processAudioQueue();
        }
    }
    
    /**
     * 处理音频队列
     */
    async processAudioQueue() {
        if (!this.audioContext) {
            console.error("音频上下文未初始化");
            return;
        }
        
        this.isProcessing = true;
        this.setStatus("处理音频中...");
        
        try {
            while (this.audioQueue.length > 0 || this.hasNewChunks) {
                this.hasNewChunks = false;
                
                if (this.audioQueue.length === 0) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    continue;
                }
                
                // 从队列中取出一个片段
                const base64Chunk = this.audioQueue.shift();
                
                // 处理音频片段
                await this.processAudioChunk(base64Chunk);
            }
            
            this.setStatus("音频处理完成");
        } catch (error) {
            console.error("处理音频队列时出错:", error);
            this.setStatus("音频处理失败");
        }
        
        this.isProcessing = false;
    }
    
    /**
     * 处理单个音频片段
     * @param {string} base64Data - Base64编码的音频数据
     */
    async processAudioChunk(base64Data) {
        try {
            // Base64解码
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            // 检查是否是第一个片段（含WAV头）
            const isFirstChunk = this.accumulatedSamples === null;
            
            // 提取PCM样本
            let samples;
            if (isFirstChunk) {
                // 第一个片段，跳过44字节的WAV头
                const wavHeader = bytes.slice(0, 44);
                const pcmData = bytes.slice(44);
                
                // 转换为Int16Array (16bit音频)
                samples = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2);
                
                // 保存WAV头信息以便后续使用
                this.wavHeader = wavHeader;
                
                // 开始播放
                this.beginPlayback();
            } else {
                // 后续片段直接是PCM数据
                samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
            }
            
            // 累积样本或添加到播放队列
            this.addSamplesToPlayback(samples);
            
        } catch (error) {
            console.error("处理音频片段时出错:", error);
        }
    }
    
    /**
     * 开始音频播放
     */
    beginPlayback() {
        if (this.isPlaying) return;
        
        // 创建音频节点
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = 1.0;
        gainNode.connect(this.audioContext.destination);
        
        this.audioNodes.gainNode = gainNode;
        this.isPlaying = true;
        this.playNextBuffer();
    }
    
    /**
     * 将样本添加到播放队列
     * @param {Int16Array} newSamples - 新的音频样本
     */
    addSamplesToPlayback(newSamples) {
        // 将Int16Array转换为Float32Array (Web Audio API需要)
        const floatSamples = new Float32Array(newSamples.length);
        for (let i = 0; i < newSamples.length; i++) {
            // 将16位整数转换为-1.0到1.0之间的浮点数
            floatSamples[i] = newSamples[i] / 32768.0;
        }
        
        // 如果之前有累积的样本，与新样本合并
        if (this.accumulatedSamples) {
            const combined = new Float32Array(this.accumulatedSamples.length + floatSamples.length);
            combined.set(this.accumulatedSamples, 0);
            combined.set(floatSamples, this.accumulatedSamples.length);
            this.accumulatedSamples = combined;
        } else {
            this.accumulatedSamples = floatSamples;
        }
        
        // 尝试播放下一个缓冲区
        if (this.isPlaying) {
            this.playNextBuffer();
        }
    }
    
    /**
     * 播放下一个音频缓冲区
     */
    playNextBuffer() {
        // 如果没有足够的样本或已经在播放中，则返回
        if (!this.accumulatedSamples || this.accumulatedSamples.length === 0) {
            return;
        }
        
        // 创建音频缓冲区
        // 每次播放0.5秒的音频
        const bufferSize = Math.min(this.sampleRate / 2, this.accumulatedSamples.length);
        
        // 创建音频缓冲区
        const audioBuffer = this.audioContext.createBuffer(1, bufferSize, this.sampleRate);
        const channelData = audioBuffer.getChannelData(0);
        channelData.set(this.accumulatedSamples.slice(0, bufferSize));
        
        // 更新累积的样本
        this.accumulatedSamples = this.accumulatedSamples.slice(bufferSize);
        
        // 创建音频源节点
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioNodes.gainNode);
        
        // 计算开始播放的时间
        const startTime = Math.max(this.audioContext.currentTime, this.playbackPosition);
        source.start(startTime);
        
        // 更新播放位置
        this.playbackPosition = startTime + audioBuffer.duration;
        
        // 在缓冲区播放结束时调度下一个缓冲区
        source.onended = () => {
            // 如果还有更多样本，继续播放
            if (this.accumulatedSamples && this.accumulatedSamples.length > 0) {
                this.playNextBuffer();
            }
        };
        
        // 或者在即将结束前安排下一个缓冲区的播放
        const timeBeforeEnd = audioBuffer.duration * 0.8; // 在结束前80%的时间点
        setTimeout(() => {
            if (this.accumulatedSamples && this.accumulatedSamples.length > 0) {
                this.playNextBuffer();
            }
        }, timeBeforeEnd * 1000);
    }
}

// 导出模块
export default AudioStreamingSystem;
