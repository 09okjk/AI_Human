/**
 * 消息处理模块 - 管理UI更新和消息显示
 */
class MessageHandler {
    constructor() {
        this.currentAiMessageId = 'current-ai-message';
    }
    
    /**
     * 更新状态消息
     * @param {string} message - 状态消息
     */
    updateStatus(message) {
        const statusMessage = document.getElementById('status-message');
        if (statusMessage) {
            statusMessage.textContent = message;
        }
    }
    
    /**
     * 更新录音指示器
     * @param {boolean} isSpeaking - 是否正在说话
     */
    updateRecordingIndicator(isSpeaking) {
        const indicator = document.getElementById('recording-indicator');
        if (indicator) {
            if (isSpeaking) {
                indicator.classList.add('active');
            } else {
                indicator.classList.remove('active');
            }
        }
    }
    
    /**
     * 更新UI为通话开始状态
     */
    updateUIForCallStart() {
        // 禁用开始按钮，启用结束按钮
        const startBtn = document.getElementById('start-call');
        const endBtn = document.getElementById('end-call');
        
        if (startBtn) startBtn.disabled = true;
        if (endBtn) endBtn.disabled = false;
    }
    
    /**
     * 更新UI为通话结束状态
     */
    updateUIForCallEnd() {
        // 启用开始按钮，禁用结束按钮
        const startBtn = document.getElementById('start-call');
        const endBtn = document.getElementById('end-call');
        
        if (startBtn) startBtn.disabled = false;
        if (endBtn) endBtn.disabled = true;
        
        // 移除录音状态
        const voiceButton = document.getElementById('voice-button');
        if (voiceButton) voiceButton.classList.remove('recording');
        
        const indicator = document.getElementById('recording-indicator');
        if (indicator) indicator.classList.remove('active');
    }
    
    /**
     * 添加消息到聊天界面
     * @param {string} sender - 发送者
     * @param {string} content - 消息内容
     * @param {string} type - 消息类型 (user/ai/system)
     */
    addMessage(sender, content, type = 'user') {
        const chatMessages = document.getElementById('chat-messages');
        if (!chatMessages) return;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        if (type === 'system') {
            // 系统消息格式
            messageDiv.classList.add('system-message');
            messageDiv.textContent = content;
        } else {
            // 用户/AI消息格式
            const nameSpan = document.createElement('div');
            nameSpan.className = 'message-sender';
            nameSpan.textContent = sender;
            
            const contentSpan = document.createElement('div');
            contentSpan.className = 'message-content';
            contentSpan.textContent = content;
            
            messageDiv.appendChild(nameSpan);
            messageDiv.appendChild(contentSpan);
        }
        
        chatMessages.appendChild(messageDiv);
        
        // 滚动到底部
        this.scrollToBottom();
    }
    
    /**
     * 更新AI回复消息（流式）
     * @param {string} message - AI消息内容
     */
    updateAIMessage(message) {
        // 查找或创建消息元素
        let aiMessageElem = document.getElementById(this.currentAiMessageId);
        
        if (!aiMessageElem) {
            aiMessageElem = document.createElement('div');
            aiMessageElem.id = this.currentAiMessageId;
            aiMessageElem.className = 'message ai';
            
            const chatMessages = document.getElementById('chat-messages');
            if (chatMessages) {
                chatMessages.appendChild(aiMessageElem);
                this.scrollToBottom();
            }
        }
        
        // 更新内容
        aiMessageElem.textContent = message;
    }
    
    /**
     * 完成AI消息
     * @param {string} message - 完整消息
     * @param {boolean} hadAudio - 是否包含音频
     */
    completeAIMessage(message, hadAudio = false) {
        // 移除临时ID
        const aiMessageElem = document.getElementById(this.currentAiMessageId);
        if (aiMessageElem) {
            aiMessageElem.id = '';
        }
        
        // 添加完整消息
        let displayMsg = message;
        if (hadAudio) {
            displayMsg += ' [语音已播放]';
        }
        this.addMessage('AI', displayMsg, 'ai');
    }
    
    /**
     * 滚动聊天区域到底部
     */
    scrollToBottom() {
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }
}

export default MessageHandler;
