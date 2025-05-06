document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const chatMessages = document.getElementById('chat-messages');
    const textInput = document.getElementById('text-input');
    const voiceButton = document.getElementById('voice-button');
    const sendButton = document.getElementById('send-button');
    const recordingIndicator = document.getElementById('recording-indicator');
    const statusMessage = document.getElementById('status-message');
    
    // Audio Context for recording and playback
    let audioContext;
    let microphone;
    let mediaRecorder;
    let audioChunks = [];
    let isRecording = false;
    let currentAudioPlayer = null;
    
    // Initialize audio context on user interaction (browser requirement)
    const initAudioContext = async () => {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            statusMessage.textContent = "音频系统已初始化";
        } catch (error) {
            console.error("Error initializing audio context:", error);
            statusMessage.textContent = "音频系统初始化失败";
        }
    };
    
    // Start recording function
    const startRecording = async () => {
        try {
            if (!audioContext) {
                await initAudioContext();
            }
            
            // Request microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            microphone = stream;
            
            // Setup media recorder
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            
            // Listen for data available event
            mediaRecorder.addEventListener('dataavailable', event => {
                audioChunks.push(event.data);
            });
            
            // Start recording
            mediaRecorder.start();
            isRecording = true;
            
            // Update UI
            voiceButton.classList.add('recording');
            recordingIndicator.classList.add('active');
            statusMessage.textContent = "正在录音...";
        } catch (error) {
            console.error("Error starting recording:", error);
            statusMessage.textContent = "无法访问麦克风";
        }
    };
    
    // Stop recording function
    const stopRecording = () => {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
            return;
        }
        
        return new Promise(resolve => {
            mediaRecorder.addEventListener('stop', async () => {
                // Create audio blob from chunks
                const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                
                // Convert to base64
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = () => {
                    const base64Audio = reader.result;
                    resolve(base64Audio);
                };
                
                // Release microphone
                if (microphone) {
                    microphone.getTracks().forEach(track => track.stop());
                }
            });
            
            // Stop recording
            mediaRecorder.stop();
            isRecording = false;
            
            // Update UI
            voiceButton.classList.remove('recording');
            recordingIndicator.classList.remove('active');
            statusMessage.textContent = "录音已完成";
        });
    };
    
    // Send message to backend
    const sendMessage = async (text = '', audioData = null) => {
        if (!text && !audioData) return;
        
        // Display user message
        if (text) {
            appendMessage(text, 'user');
        } else {
            appendMessage('🎤 [语音消息]', 'user');
        }
        
        try {
            statusMessage.textContent = "正在处理...";
            
            // Prepare request data
            const requestData = {};
            if (text) requestData.text = text;
            if (audioData) requestData.audio = audioData;
            
            // Send to backend
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
            
            // Handle SSE stream response
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            let aiResponseText = '';
            let audioBase64Chunks = [];
            
            // Create message placeholder for AI response
            const messageElement = document.createElement('div');
            messageElement.className = 'message ai-message';
            messageElement.innerHTML = '<div class="typing-indicator">AI 正在回复...</div>';
            chatMessages.appendChild(messageElement);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            
            // 使用更健壮的方式处理SSE数据
            let buffer = '';
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                // 解码新数据并添加到缓冲区
                buffer += decoder.decode(value, { stream: true });
                
                // 查找完整的SSE消息
                const lines = buffer.split('\n\n');
                
                // 保留最后一个可能不完整的片段
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        try {
                            // 尝试解析JSON数据
                            const jsonStr = line.substring(5).trim();
                            const data = JSON.parse(jsonStr);
                            
                            if (data.type === 'text' && data.content) {
                                aiResponseText += data.content;
                                messageElement.innerHTML = aiResponseText;
                            } 
                            else if (data.type === 'audio' && data.content) {
                                audioBase64Chunks.push(data.content);
                                // 记录接收到音频数据
                                console.log("收到音频数据片段");
                            }
                            else if (data.type === 'transcript' && data.content) {
                                console.log("Transcript:", data.content);
                                // 将转录显示在消息中
                                if (!aiResponseText) {
                                    aiResponseText = `"${data.content}" `;  
                                    messageElement.innerHTML = aiResponseText;
                                }
                            }
                            else if (data.type === 'error') {
                                console.error("服务器错误:", data.content);
                                messageElement.innerHTML = `<span class="error">服务器错误: ${data.content}</span>`;
                            }
                        } catch (e) {
                            console.error("解析SSE数据错误:", e);
                            // 继续处理下一条消息，不中断流程
                        }
                    }
                }
                
                // 自动滚动到底部
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
            
            // Play audio response if we received any
            if (audioBase64Chunks.length > 0) {
                playAudioResponse(audioBase64Chunks);
            }
            
            statusMessage.textContent = "回复完成";
        } catch (error) {
            console.error("Error sending message:", error);
            statusMessage.textContent = "发送消息失败";
            appendMessage("⚠️ 发送消息出错，请稍后重试", "system");
        }
    };
    
    // Append message to chat
    const appendMessage = (text, sender) => {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${sender}-message`;
        messageElement.textContent = text;
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    };
    
    // Play audio response - 改进的音频播放功能
    const playAudioResponse = async (base64Chunks) => {
        try {
            if (!audioContext) {
                await initAudioContext();
            }
            
            // 如果当前有音频在播放，停止它
            if (currentAudioPlayer) {
                currentAudioPlayer.pause();
                currentAudioPlayer = null;
            }
            
            // 记录音频数据长度，用于调试
            console.log(`收到 ${base64Chunks.length} 个音频片段`);
            
            if (base64Chunks.length === 0) {
                console.warn("没有收到音频数据，无法播放");
                statusMessage.textContent = "未收到音频数据";
                return;
            }
            
            // 合并所有音频片段并移除可能的前缀
            let fullBase64 = base64Chunks.join('');
            
            // 移除可能存在的 data URI 前缀
            if (fullBase64.startsWith('data:audio/wav;base64,')) {
                fullBase64 = fullBase64.substring('data:audio/wav;base64,'.length);
            }
            
            // 确保 Base64 字符串的有效性
            try {
                // 尝试解码一下看是否有效
                atob(fullBase64.substring(0, 10));
                console.log("Base64 格式有效");
            } catch (e) {
                console.error("Base64 格式无效:", e);
                statusMessage.textContent = "音频数据格式错误";
                return;
            }
            
            // 创建一个 blob URL 而不是直接使用 data URI
            const byteCharacters = atob(fullBase64);
            const byteNumbers = new Array(byteCharacters.length);
            
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'audio/wav' });
            const audioUrl = URL.createObjectURL(blob);
            
            // 创建音频元素并播放
            const audio = new Audio(audioUrl);
            currentAudioPlayer = audio;
            
            // 监听错误
            audio.onerror = (e) => {
                console.error("音频播放错误:", e);
                statusMessage.textContent = "播放音频失败";
                URL.revokeObjectURL(audioUrl); // 释放URL
            };
            
            // 播放结束时的处理
            audio.onended = () => {
                currentAudioPlayer = null;
                statusMessage.textContent = "就绪";
                URL.revokeObjectURL(audioUrl); // 释放URL
            };
            
            // 加载完成后播放
            audio.oncanplaythrough = () => {
                statusMessage.textContent = "正在播放回复...";
                audio.play().catch(err => {
                    console.error("播放音频失败:", err);
                    statusMessage.textContent = "播放音频失败";
                });
            };
            
            // 设置超时，如果加载时间过长，给出提示
            setTimeout(() => {
                if (audio.readyState < 3) { // HAVE_FUTURE_DATA = 3
                    console.warn("音频加载时间过长");
                    statusMessage.textContent = "音频加载中...";
                }
            }, 2000);
            
        } catch (error) {
            console.error("处理音频时出错:", error);
            statusMessage.textContent = "播放音频失败";
        }
    };
    
    // Event Listeners
    voiceButton.addEventListener('click', async () => {
        if (isRecording) {
            const audioData = await stopRecording();
            sendMessage('', audioData);
        } else {
            startRecording();
        }
    });
    
    sendButton.addEventListener('click', () => {
        const text = textInput.value.trim();
        if (text) {
            sendMessage(text);
            textInput.value = '';
        }
    });
    
    textInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const text = textInput.value.trim();
            if (text) {
                sendMessage(text);
                textInput.value = '';
            }
        }
    });
    
    // Initialize
    document.body.addEventListener('click', async () => {
        if (!audioContext) {
            await initAudioContext();
        }
    }, { once: true });
});
