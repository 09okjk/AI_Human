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
            // 处理音频并发送到服务器
            const response = await this.recorder.processAudioAndSend(audioBlob, this.sessionId);
            
            if (response && response.success) {
                // 切换为AI响应状态
                this.isAiResponding = true;
                this.setStatus("AI正在回复...");
                
                // 处理SSE流响应
                await this.handleAiResponse(response);
            } else {
                throw new Error("服务器响应错误");
            }
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
     * 处理AI响应
     * @param {Object} response - 服务器响应
     */
    async handleAiResponse(response) {
        try {
            // 创建EventSource或使用MessageHandler处理流式响应
            const eventSource = new EventSource(`/api/stream-response?session_id=${this.sessionId}`);
            
            // 是否收到第一条消息
            let firstMessageReceived = false;
            
            eventSource.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                // 如果是第一条消息，重新开始监听以支持打断功能
                if (!firstMessageReceived) {
                    firstMessageReceived = true;
                    console.log("收到第一条响应，重新开始监听以支持打断功能");
                    setTimeout(() => {
                        if (this.isSessionActive && !this.isListening) {
                            this.startListening();
                        }
                    }, 500);
                }
                
                // 处理不同类型的消息
                if (data.type === 'text') {
                    Typewriter.addToTypingBuffer(data.content, false);
                    Typewriter.startTypewriter(this.messageHandler.aiMessageElement, this.chatMessages);
                } 
                else if (data.type === 'audio') {
                    this.audioSystem.addAudioChunk(data.content);
                }
                else if (data.type === 'end') {
                    // 响应结束
                    eventSource.close();
                    this.onAiResponseComplete();
                }
            };
            
            eventSource.onerror = (error) => {
                console.error("EventSource错误:", error);
                eventSource.close();
                this.onAiResponseComplete();
            };
            
            // 创建AI回复的消息占位符
            this.messageHandler.aiMessageElement = document.createElement('div');
            this.messageHandler.aiMessageElement.className = 'message ai-message';
            this.messageHandler.aiMessageElement.innerHTML = '<div class="typing-indicator">AI 正在回复...</div>';
            this.chatMessages.appendChild(this.messageHandler.aiMessageElement);
            this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
            
            // 重置打字机
            Typewriter.resetTypewriter();
            
        } catch (error) {
            console.error("处理AI响应时出错:", error);
            this.onAiResponseComplete();
        }
    }
    
    /**
     * AI响应完成回调
     */
    onAiResponseComplete() {
        this.isAiResponding = false;
        this.setStatus("等待用户输入...");
        
        // 完成打字机效果
        Typewriter.finalizeTypewriter(() => {
            console.log("AI响应完成");
            
            // 如果会话仍然活跃且没有正在监听，开始新一轮监听
            if (this.isSessionActive && !this.isListening) {
                setTimeout(() => this.startListening(), 500);
            }
        });
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
