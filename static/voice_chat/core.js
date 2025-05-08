/**
 * 实时语音通话功能 - 核心模块
 * 提供语音通话的核心功能和状态管理
 * 基于录音对话功能，实现连续对话
 */

import AudioRecorder from '../js/audio-recorder.js';
import AudioStreamingSystem from '../js/audio-streaming.js';
import MessageHandler from '../js/message-handler.js';
import Typewriter from '../js/typewriter.js';

class VoiceChat {
    /**
     * 构造函数
     * @param {Object} elementRefs - 页面元素引用
     * @param {HTMLDivElement} elementRefs.chatMessages - 聊天消息容器
     * @param {HTMLDivElement} elementRefs.statusElement - 状态显示元素
     * @param {HTMLButtonElement} elementRefs.startButton - 开始通话按钮
     * @param {HTMLButtonElement} elementRefs.stopButton - 结束通话按钮
     */
    constructor(elementRefs) {
        // 保存元素引用
        this.chatMessages = elementRefs.chatMessages;
        this.statusElement = elementRefs.statusElement;
        this.startButton = elementRefs.startButton;
        this.stopButton = elementRefs.stopButton;
        
        // 创建音频上下文
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // 初始化组件
        this.recorder = new AudioRecorder(this.statusElement);
        this.audioSystem = new AudioStreamingSystem(this.statusElement);
        this.audioSystem.init(this.audioContext);
        this.messageHandler = new MessageHandler(
            { 
                chatMessages: this.chatMessages, 
                statusElement: this.statusElement 
            }, 
            Typewriter, 
            this.audioSystem
        );
        
        // 会话状态
        this.isSessionActive = false;
        this.isListening = false;
        this.isAiResponding = false;
        this.sessionId = null;
        this.silenceTimer = null;
        this.silenceThreshold = 1.5; // 静音阈值（秒）
        
        // 绑定按钮事件
        this.bindEvents();
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
     * 绑定UI事件
     */
    bindEvents() {
        if (this.startButton) {
            this.startButton.addEventListener('click', () => this.startConversation());
        }
        
        if (this.stopButton) {
            this.stopButton.addEventListener('click', () => this.endConversation());
        }
    }
    
    /**
     * 启动语音对话会话
     */
    async startConversation() {
        if (this.isSessionActive) return;
        
        this.isSessionActive = true;
        this.sessionId = this.generateSessionId();
        this.setStatus("正在启动语音对话...");
        
        // 更新按钮状态
        if (this.startButton) this.startButton.disabled = true;
        if (this.stopButton) this.stopButton.disabled = false;
        
        // 添加会话开始提示
        this.messageHandler.appendMessage("🎙️ 语音对话已开始，请开始说话...", "system");
        
        // 开始监听
        await this.startListening();
    }
    
    /**
     * 结束语音对话会话
     */
    async endConversation() {
        if (!this.isSessionActive) return;
        
        // 停止录音和监听
        this.stopListening();
        
        // 重置会话状态
        this.isSessionActive = false;
        this.isAiResponding = false;
        
        // 更新按钮状态
        if (this.startButton) this.startButton.disabled = false;
        if (this.stopButton) this.stopButton.disabled = true;
        
        // 添加会话结束提示
        this.messageHandler.appendMessage("🎙️ 语音对话已结束", "system");
        this.setStatus("语音对话已结束");
    }
    
    /**
     * 开始录音和语音监听
     */
    async startListening() {
        if (this.isListening) return;
        
        this.isListening = true;
        this.setStatus("正在聆听...");
        
        // 启动录音器，并设置回调函数
        const success = await this.recorder.startRecording(
            // 录音完成回调 - 在stopListening中触发
            (audioBlob) => this.onRecordingComplete(audioBlob),
            // 音频电平回调 - 用于检测语音活动
            (audioLevel) => this.onAudioLevelChange(audioLevel)
        );
        
        if (!success) {
            this.setStatus("无法启动麦克风");
            this.isListening = false;
            return;
        }
        
        // 启动静音检测
        this.resetSilenceTimer();
    }
    
    /**
     * 停止录音和语音监听
     */
    async stopListening() {
        if (!this.isListening) return;
        
        // 清除静音计时器
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
        
        // 停止录音
        await this.recorder.stopRecording();
        this.isListening = false;
        this.setStatus("处理中...");
    }
    
    /**
     * 重置静音检测计时器
     */
    resetSilenceTimer() {
        // 清除现有的计时器
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
        
        // 如果AI正在响应或会话未激活，则不设置计时器
        if (this.isAiResponding || !this.isSessionActive) return;
        
        // 设置新的静音检测计时器
        this.silenceTimer = setTimeout(() => {
            if (this.isListening && this.isSessionActive) {
                console.log("检测到语音停顿，停止录音...");
                this.stopListening();
            }
        }, this.silenceThreshold * 1000);
    }
    
    /**
     * 音频电平变化回调
     * @param {number} level - 音频电平 (0-1)
     */
    onAudioLevelChange(level) {
        // 如果检测到明显的声音活动，重置静音检测
        if (level > 0.05) { // 可以调整这个阈值
            this.resetSilenceTimer();
            
            // 如果AI正在回复，检测到用户开始说话，就打断AI的回复
            if (this.isAiResponding) {
                console.log("检测到用户打断，停止AI回复...");
                this.interruptAiResponse();
            }
        }
    }
    
    /**
     * 录音完成回调
     * @param {Blob} audioBlob - 录音的音频数据
     */
    async onRecordingComplete(audioBlob) {
        if (!audioBlob || !this.isSessionActive) return;
        
        try {
            // 检查录音的有效性（判断用户是否真的在说话）
            const isValidAudio = await this.checkAudioValidity(audioBlob);
            
            if (!isValidAudio) {
                console.log('未检测到有效的语音内容，重新开始监听...');
                this.setStatus('未检测到有效语音，请继续说话...');
                
                // 延迟少许时间再重新开始录音，避免用户回调函数堆叠
                setTimeout(() => {
                    if (this.isSessionActive && !this.isListening) {
                        this.startListening();
                    }
                }, 500);
                
                return; // 直接返回，不发送请求
            }
            
            // 将Blob转换为Base64
            const base64Audio = await this.blobToBase64(audioBlob);
            
            // 直接使用/api/chat接口发送音频数据
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    audio: base64Audio,
                    session_id: this.sessionId
                })
            });
            
            if (!response.ok) {
                throw new Error(`服务器响应错误: ${response.status}`);
            }
            
            // 切换为AI响应状态
            this.isAiResponding = true;
            this.setStatus("AI正在回复...");
            
            // 使用MessageHandler直接处理响应
            // 不需要再添加用户消息，sendMessage会处理
            this.messageHandler.sendMessage('', base64Audio);
            
            // 添加一个监听器，当收到第一个响应时启动新的录音
            // 以支持打断功能
            setTimeout(() => {
                if (this.isSessionActive && !this.isListening) {
                    this.startListening();
                }
            }, 2000); // 等待一段时间后重新开始监听
        } catch (error) {
            console.error("处理录音时出错:", error);
            this.messageHandler.appendMessage("⚠️ 处理录音时出错，请重试", "system");
            
            // 出错后重新开始监听
            if (this.isSessionActive) {
                setTimeout(() => this.startListening(), 1000);
            }
        }
    }
    
    /**
     * 检查录音数据是否包含有效的语音内容
     * @param {Blob} audioBlob - 要检查的音频Blob
     * @returns {Promise<boolean>} - 是否包含有效语音
     */
    async checkAudioValidity(audioBlob) {
        if (!audioBlob || audioBlob.size < 1000) {
            // 如果音频数据小于1KB，很可能就是噪音或静音
            console.log('音频大小过小，不发送:', audioBlob.size, 'bytes');
            return false;
        }
        
        try {
            // 将音频blob转换为可分析的ArrayBuffer
            const arrayBuffer = await audioBlob.arrayBuffer();
            
            // 创建临时AudioContext进行分析
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // 解码音频数据
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            // 获取音频样本数据
            const channelData = audioBuffer.getChannelData(0); // 获取第一个声道
            
            // 计算RMS（均方根）值来判断音量大小
            let sumSquares = 0.0;
            for (let i = 0; i < channelData.length; i++) {
                sumSquares += channelData[i] * channelData[i];
            }
            const rms = Math.sqrt(sumSquares / channelData.length);
            
            // 检查强度波动
            // 计算每个分段内的最大值
            const segmentSize = audioContext.sampleRate / 10; // 大约100ms的片段
            const segments = Math.floor(channelData.length / segmentSize);
            let validSegments = 0;
            
            for (let i = 0; i < segments; i++) {
                const start = i * segmentSize;
                const end = start + segmentSize;
                
                let maxValue = 0;
                for (let j = start; j < end && j < channelData.length; j++) {
                    maxValue = Math.max(maxValue, Math.abs(channelData[j]));
                }
                
                // 判断此片段是否有有效语音
                if (maxValue > 0.02) { // 调整这个阈值来控制灵敏度
                    validSegments++;
                }
            }
            
            // 清理资源
            audioContext.close();
            
            // 判断标准：
            // 1. RMS值要足够大
            // 2. 至少有3个有效片段
            const isValidRMS = rms > 0.01; // 调整这个阈值来控制整体音量要求
            const hasEnoughValidSegments = validSegments >= 3; // 至少要有三个有效片段
            
            console.log(
                '音频分析结果:',
                `大小=${(audioBlob.size/1024).toFixed(2)}KB`,
                `RMS=${rms.toFixed(4)}`,
                `有效片段=${validSegments}/${segments}`,
                `有效=${isValidRMS && hasEnoughValidSegments}`
            );
            
            return isValidRMS && hasEnoughValidSegments;
            
        } catch (error) {
            console.error('音频有效性检查出错:', error);
            // 出错则默认允许通过，避免阻止正常录音
            return true;
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
     * 处理AI响应 - 简化版
     * 现在我们使用MessageHandler直接处理响应，不需要复杂的EventSource逻辑
     * @param {Event} event - 消息事件
     */
    handleAiResponse(event) {
        // 该方法保留为兼容性目的，实际上现在用不到
        console.log('新版中移除了单独的响应处理逻辑，使用MessageHandler处理');
        
        // 如果需要，可以在此添加额外的响应处理逻辑
    }
    
    /**
     * AI响应完成回调
     * 这个方法在MessageHandler完成处理消息后会被自动调用
     */
    onAiResponseComplete() {
        // 等待一小段时间确保所有消息已完成处理
        setTimeout(() => {
            this.isAiResponding = false;
            this.setStatus("等待用户输入...");
            
            // 如果会话仍然活跃且没有正在监听，确保开始新一轮监听
            if (this.isSessionActive && !this.isListening) {
                console.log("响应完成，重新开始监听用户输入");
                this.startListening();
            }
        }, 1000); // 等待1秒确保所有响应已完成
    }
    
    /**
     * 打断AI响应
     */
    interruptAiResponse() {
        // 向服务器发送打断请求
        fetch('/api/interrupt', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                session_id: this.sessionId
            })
        }).then(response => {
            if (!response.ok) {
                console.error("打断请求失败:", response.status);
            }
        }).catch(error => {
            console.error("发送打断请求时出错:", error);
        });
        
        // 立即结束AI响应状态
        this.isAiResponding = false;
        
        // 添加打断指示
        if (this.messageHandler.aiMessageElement) {
            this.messageHandler.aiMessageElement.innerHTML += ' <span class="interrupt-indicator">[用户打断]</span>';
        }
        
        // 完成打字机效果
        Typewriter.finalizeTypewriter(() => {
            console.log("AI响应被打断");
        });
    }
    
    /**
     * 生成唯一会话ID
     * @returns {string} - 会话ID
     */
    generateSessionId() {
        return Date.now().toString(36) + Math.random().toString(36).substring(2);
    }
}

// 导出类
export default VoiceChat;
