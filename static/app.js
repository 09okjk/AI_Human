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
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n\n');
                
                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        try {
                            const data = JSON.parse(line.substring(5));
                            
                            if (data.type === 'text' && data.content) {
                                aiResponseText += data.content;
                                messageElement.innerHTML = aiResponseText;
                            } 
                            else if (data.type === 'audio' && data.content) {
                                audioBase64Chunks.push(data.content);
                            }
                            else if (data.type === 'transcript' && data.content) {
                                // Handle transcript if needed
                                console.log("Transcript:", data.content);
                            }
                            else if (data.type === 'usage') {
                                console.log("Usage info:", data.content);
                            }
                        } catch (e) {
                            console.error("Error parsing SSE data:", e);
                        }
                    }
                }
                
                // Auto-scroll to bottom
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
    
    // Play audio response
    const playAudioResponse = async (base64Chunks) => {
        try {
            if (!audioContext) {
                await initAudioContext();
            }
            
            // If there's a current audio playing, stop it
            if (currentAudioPlayer) {
                currentAudioPlayer.pause();
                currentAudioPlayer = null;
            }
            
            // Combine all audio chunks
            const fullBase64 = base64Chunks.join('');
            
            // Create audio element and play
            const audio = new Audio(`data:audio/wav;base64,${fullBase64}`);
            currentAudioPlayer = audio;
            audio.play();
            
            statusMessage.textContent = "正在播放回复...";
            
            audio.onended = () => {
                currentAudioPlayer = null;
                statusMessage.textContent = "就绪";
            };
        } catch (error) {
            console.error("Error playing audio:", error);
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
