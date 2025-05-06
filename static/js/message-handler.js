/**
 * 消息处理模块
 * 处理发送消息、接收服务器响应和SSE流
 */

class MessageHandler {
    constructor(elementRefs, typewriter, audioSystem) {
        this.chatMessages = elementRefs.chatMessages;
        this.statusElement = elementRefs.statusElement;
        
        this.typewriter = typewriter;
        this.audioSystem = audioSystem;
        
        // 用于存储音频片段
        this.audioBase64Chunks = [];
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
     * 添加消息到聊天窗口
     * @param {string} text - 消息文本
     * @param {string} sender - 发送者 ('user', 'ai', 'system')
     * @returns {HTMLElement} - 添加的消息元素
     */
    appendMessage(text, sender) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${sender}-message`;
        messageElement.textContent = text;
        this.chatMessages.appendChild(messageElement);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        return messageElement;
    }

    /**
     * 向服务器发送消息并处理响应
     * @param {string} text - 文本消息 (可选)
     * @param {string} audioData - Base64编码的音频数据 (可选)
     */
    async sendMessage(text = '', audioData = null) {
        if (!text && !audioData) return;
        
        // 显示用户消息
        if (text) {
            this.appendMessage(text, 'user');
        } else {
            this.appendMessage('🎤 [语音消息]', 'user');
        }
        
        try {
            this.setStatus("正在处理...");
            
            // 准备请求数据
            const requestData = {};
            if (text) requestData.text = text;
            if (audioData) requestData.audio = audioData;
            
            // 发送到后端
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData),
            });
            
            if (!response.ok) {
                throw new Error(`Server responded with ${response.status}`);
            }
            
            // 处理SSE流响应
            await this.handleSSEResponse(response);
            
        } catch (error) {
            console.error("Error sending message:", error);
            this.setStatus("发送消息失败");
            this.appendMessage("⚠️ 发送消息出错，请稍后重试", "system");
        }
    }
    
    /**
     * 处理服务器的SSE流响应
     * @param {Response} response - Fetch API响应对象
     */
    async handleSSEResponse(response) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        this.audioBase64Chunks = [];
        
        // 创建AI回复的消息占位符
        const messageElement = document.createElement('div');
        messageElement.className = 'message ai-message';
        messageElement.innerHTML = '<div class="typing-indicator">AI 正在回复...</div>';
        this.chatMessages.appendChild(messageElement);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        
        // 重置打字机状态准备新消息
        this.typewriter.resetTypewriter();
        
        // 处理SSE数据流
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
                if (line.startsWith('data:')) {
                    try {
                        const jsonStr = line.substring(5).trim();
                        const data = JSON.parse(jsonStr);
                        
                        if (data.type === 'text' && data.content) {
                            // 处理文本消息
                            this.typewriter.addToTypingBuffer(data.content, false);
                            this.typewriter.startTypewriter(messageElement, this.chatMessages);
                        } 
                        else if (data.type === 'audio' && data.content) {
                            // 处理音频数据
                            this.audioBase64Chunks.push(data.content);
                            this.audioSystem.addAudioChunk(data.content);
                        }
                        else if (data.type === 'transcript' && data.content) {
                            // 处理转录内容
                            console.log("Transcript:", data.content);
                            this.typewriter.addToTypingBuffer(data.content, true);
                            this.typewriter.startTypewriter(messageElement, this.chatMessages);
                        }
                        else if (data.type === 'error') {
                            // 处理错误
                            console.error("服务器错误:", data.content);
                            messageElement.innerHTML = `<span class="error">服务器错误: ${data.content}</span>`;
                        }
                    } catch (e) {
                        console.error("解析SSE数据错误:", e);
                    }
                }
            }
            
            // 自动滚动到底部
            this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        }
        
        // SSE流结束处理
        if (this.typewriter.getTypingBuffer()) {
            // 如果是引用式消息，添加右引号并完成打字效果
            this.typewriter.finalizeTypewriter(() => {
                this.setStatus("回复完成");
            });
        } else {
            this.setStatus("回复完成");
        }
    }
}

export default MessageHandler;
