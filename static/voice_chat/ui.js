/**
 * 语音通话UI交互模块
 * 处理界面更新和用户交互
 */

// 更新AI回复消息（流式）
function updateAIMessage(message) {
    // 查找或创建消息元素
    let aiMessageElem = document.getElementById('current-ai-message');
    
    if (!aiMessageElem) {
        aiMessageElem = document.createElement('div');
        aiMessageElem.id = 'current-ai-message';
        aiMessageElem.className = 'message ai';
        
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) {
            chatMessages.appendChild(aiMessageElem);
            
            // 滚动到底部
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }
    
    // 更新内容
    aiMessageElem.textContent = message;
}

// 完成AI消息
function completeAIMessage(message, hadAudio = false) {
    // 移除临时ID
    const aiMessageElem = document.getElementById('current-ai-message');
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

// 添加消息到聊天界面
function addMessage(sender, content, type = 'user') {
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
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 更新录音指示器
function updateRecordingIndicator(isSpeaking) {
    const indicator = document.getElementById('recording-indicator');
    if (indicator) {
        if (isSpeaking && this.isRecording) {
            indicator.classList.add('active');
        } else {
            indicator.classList.remove('active');
        }
    }
}

// 更新状态消息
function updateStatus(message) {
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
        statusMessage.textContent = message;
    }
}

// 更新UI为通话开始状态
function updateUIForCallStart() {
    // 禁用开始按钮，启用结束按钮
    document.getElementById('start-call').disabled = true;
    document.getElementById('end-call').disabled = false;
}

// 更新UI为通话结束状态
function updateUIForCallEnd() {
    // 启用开始按钮，禁用结束按钮
    document.getElementById('start-call').disabled = false;
    document.getElementById('end-call').disabled = true;
    
    // 移除录音状态
    const voiceButton = document.getElementById('voice-button');
    if (voiceButton) voiceButton.classList.remove('recording');
    
    const indicator = document.getElementById('recording-indicator');
    if (indicator) indicator.classList.remove('active');
}

// 导出UI相关函数
export default {
    updateAIMessage,
    completeAIMessage,
    addMessage,
    updateRecordingIndicator,
    updateStatus,
    updateUIForCallStart,
    updateUIForCallEnd
};
