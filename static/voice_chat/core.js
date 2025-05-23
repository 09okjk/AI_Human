/**
 * 实时语音通话功能 - 核心模块
 * 提供语音通话的核心功能和状态管理
 * 基于录音对话功能，实现连续对话
 */

import AudioRecorder from '../js/audio-recorder.js';
import AudioStreamingSystem from '../js/audio-streaming.js';
import MessageHandler from '../js/message-handler.js';
import Typewriter from '../js/typewriter.js';
import ResponseQueueManager from './response-queue-manager.js';

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
        
        // 初始化响应队列管理器
        this.queueManager = new ResponseQueueManager(5); // 最多保存5个对话队列
        
        // 会话状态
        this.isSessionActive = false;
        this.isListening = false;
        this.isAiResponding = false;
        this.sessionId = null;
        this.currentDialogId = null; // 当前对话 ID
        this.silenceTimer = null;
        this.silenceThreshold = 1.5; // 静音阈值（秒）
        
        // 我们需要覆盖 MessageHandler 中的原生方法，以使用我们的队列管理
        this.patchMessageHandler();
        
        // 绑定按钮事件
        this.bindEvents();
    }
    
    /**
     * 覆盖 MessageHandler 中的原生方法，以处理队列的响应
     */
    patchMessageHandler() {
        const originalHandleSSEResponse = this.messageHandler.handleSSEResponse;
        const voiceChat = this;
        
        // 重写 handleSSEResponse 方法
        this.messageHandler.handleSSEResponse = async function(response) {
            // 获取原始 reader
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            // 确保有当前对话 ID
            const dialogId = voiceChat.currentDialogId;
            if (!dialogId) {
                console.error('缺少对话 ID，无法处理响应');
                return;
            }
            
            // 创建AI回复的消息占位符
            this.aiMessageElement = document.createElement('div');
            this.aiMessageElement.className = 'message ai-message';
            this.aiMessageElement.innerHTML = '<div class="typing-indicator">AI 正在回复...</div>';
            this.chatMessages.appendChild(this.aiMessageElement);
            this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
            
            // 重置打字机
            Typewriter.resetTypewriter();
            
            // 初始化变量
            let buffer = '';
            
            // 处理SSE数据流
            while (true) {
                try {
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
                                
                                // 检查当前对话队列是否仍然活跃
                                if (!voiceChat.queueManager.isQueueActiveById(dialogId)) {
                                    console.log(`队列 ${dialogId} 已不活跃，忽略数据`); 
                                    continue;
                                }
                                
                                // 将数据添加到队列
                                voiceChat.queueManager.addResponse(dialogId, data);
                                
                                // 处理数据类型
                                if (data.type === 'text' && data.content) {
                                    // 处理文本消息
                                    Typewriter.addToTypingBuffer(data.content, false);
                                    Typewriter.startTypewriter(this.aiMessageElement, this.chatMessages);
                                } 
                                else if (data.type === 'audio' && data.content) {
                                    // 处理音频数据
                                    voiceChat.audioSystem.addAudioChunk(data.content);
                                }
                                else if (data.type === 'transcript' && data.content) {
                                    // 处理转录内容
                                    console.log("Transcript:", data.content);
                                    Typewriter.addToTypingBuffer(data.content, true);
                                    Typewriter.startTypewriter(this.aiMessageElement, this.chatMessages);
                                }
                                else if (data.type === 'error') {
                                    // 处理错误
                                    console.error("服务器错误:", data.content);
                                    this.aiMessageElement.innerHTML = `<span class="error">服务器错误: ${data.content}</span>`;
                                }
                                else if (data.type === 'end') {
                                    // 响应结束
                                    voiceChat.onAiResponseComplete();
                                }
                            } catch (e) {
                                console.error("解析SSE数据错误:", e);
                            }
                        }
                    }
                    
                    // 自动滚动到底部
                    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
                    
                } catch (error) {
                    if (error.name === 'AbortError') {
                        console.log('请求被用户取消');
                    } else {
                        console.error('读取响应流错误:', error);
                    }
                    break;
                }
            }
            
            // SSE流结束处理
            if (Typewriter.getTypingBuffer()) {
                // 如果是引用式消息，添加右引号并完成打字效果
                Typewriter.finalizeTypewriter(() => {
                    this.setStatus("回复完成");
                    voiceChat.onAiResponseComplete();
                });
            } else {
                this.setStatus("回复完成");
                voiceChat.onAiResponseComplete();
            }
        };
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
        // 生成唯一的会话 ID 和对话 ID
        this.sessionId = this.generateSessionId();
        this.currentDialogId = null; // 先设置为 null，在开始监听时会初始化
        
        // 重置队列管理器
        this.queueManager.clearAll();
        
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
        
        // 重置中断计数器
        this.interruptCounter = 0;
        
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
        if (level > 0.07) { // 增加了阈值，更加防止偶发噪音触发打断
            this.resetSilenceTimer();
            
            // 如果AI正在回复，检测到用户开始说话，就打断AI的回复
            if (this.isAiResponding) {
                // 增加连续高音量的校验，保证确实是用户说话而不是噪音
                // 使用渐进counter模式，防止类似湿声导致的误触发
                if (!this.interruptCounter) this.interruptCounter = 0;
                this.interruptCounter++;
                
                // 如果检测到连续3次以上的高音量，则认为是有效打断
                if (this.interruptCounter >= 3) {
                    console.log("检测到用户打断，停止AI回复...");
                    this.interruptAiResponse();
                    this.interruptCounter = 0; // 重置计数器
                }
            } else {
                // 如果不是打断状态，重置计数器
                this.interruptCounter = 0;
            }
        } else {
            // 如果音量低，通常要重置计数器
            // 防止音量波动导致偶尔高音量时的误触发
            if (this.interruptCounter > 0) {
                this.interruptCounter--;
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
            
            // 为当前对话生成唯一ID
            const dialogId = this.generateDialogId();
            this.currentDialogId = dialogId;
            console.log(`开始新对话: ${dialogId}`);
            
            // 打断之前的队列（如果有）
            this.queueManager.interruptCurrentQueue();
            
            // 创建新的队列来处理这个对话
            this.queueManager.createQueue(dialogId);
            
            // 在应用级别创建AbortController管理
            if (!window.activeRequests) {
                window.activeRequests = [];
            }
            
            // 创建AbortController来支持请求取消
            const controller = new AbortController();
            const signal = controller.signal;
            
            // 将这个控制器添加到全局列表中，使其可以在打断时被取消
            window.activeRequests.push(controller);
            
            // 将Blob转换为Base64
            const base64Audio = await this.blobToBase64(audioBlob);
            
            // 保存控制器与当前对话的关联
            this.currentController = controller;
            
            // 直接使用/api/chat接口发送音频数据，使用AbortSignal
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    audio: base64Audio,
                    session_id: this.sessionId,
                    dialog_id: dialogId // 将对话ID也发送给服务器（可选）
                }),
                signal: signal // 使用AbortSignal来支持取消
            });
            
            // 请求完成后从活动请求列表中移除
            const index = window.activeRequests.indexOf(controller);
            if (index > -1) {
                window.activeRequests.splice(index, 1);
            }
            
            if (!response.ok) {
                throw new Error(`服务器响应错误: ${response.status}`);
            }
            
            // 切换为AI响应状态
            this.isAiResponding = true;
            this.setStatus("AI正在回复...");
            
            // 使用MessageHandler直接处理响应
            // 不需要再添加用户消息，sendMessage会处理
            this.messageHandler.appendMessage('🎙️ [语音消息]', 'user');
            await this.messageHandler.handleSSEResponse(response);
            
            // 使用定时器重新开始录音，以支持打断功能
            setTimeout(() => {
                if (this.isSessionActive && !this.isListening && this.isAiResponding) {
                    console.log('已收到AI响应，开启录音以支持打断');
                    this.startListening();
                }
            }, 1500); // 约荃1.5秒后开始录音，这个时间应该足以收到第一个响应
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
        // 保存用户方便调试的设置
        const AUDIO_SIZE_THRESHOLD = 800;      // 最小文件大小 (字节)
        const RMS_THRESHOLD = 0.005;           // RMS音量阈值 (0-1)
        const SEGMENT_THRESHOLD = 0.015;       // 单片段音量阈值 (0-1)
        const MIN_VALID_SEGMENTS = 2;         // 最少有效片段数
        const SEGMENT_DURATION_MS = 100;      // 分析片段长度 (ms)
        
        // 检查音频大小
        if (!audioBlob || audioBlob.size < AUDIO_SIZE_THRESHOLD) {
            console.log(`音频太小 (${audioBlob?.size || 0} < ${AUDIO_SIZE_THRESHOLD} bytes), 不发送`);
            return false;
        }
        
        try {
            // 将音频blob转换为可分析的ArrayBuffer
            const arrayBuffer = await audioBlob.arrayBuffer();
            
            // 创建临时AudioContext进行分析
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // 解码音频数据
            let audioBuffer;
            try {
                audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            } catch (decodeError) {
                console.error('音频解码错误:', decodeError);
                audioContext.close();
                return false; // 解码错误说明不是有效的音频数据
            }
            
            // 获取音频样本数据
            const channelData = audioBuffer.getChannelData(0); // 获取第一个声道
            
            // 检查是否是空音频或欠缺数据
            if (!channelData || channelData.length === 0) {
                console.log('音频数据为空');
                audioContext.close();
                return false;
            }
            
            // 使用滤波处理降噪，减少背景噪音的影响
            // 这里使用简单的移动平均代替正式的滤波器
            const smoothedData = new Float32Array(channelData.length);
            const smoothingFactor = 3; // 移动平均窗口大小
            
            for (let i = 0; i < channelData.length; i++) {
                let sum = 0;
                let count = 0;
                for (let j = Math.max(0, i - smoothingFactor); j <= Math.min(channelData.length - 1, i + smoothingFactor); j++) {
                    sum += Math.abs(channelData[j]);
                    count++;
                }
                smoothedData[i] = sum / count;
            }
            
            // 计算RMS（均方根）值来判断音量大小
            let sumSquares = 0.0;
            let peakValue = 0.0; // 整个音频的峰值
            
            for (let i = 0; i < channelData.length; i++) {
                sumSquares += channelData[i] * channelData[i];
                peakValue = Math.max(peakValue, Math.abs(channelData[i]));
            }
            
            const rms = Math.sqrt(sumSquares / channelData.length);
            
            // 检查强度波动，使用平滑后的数据
            // 计算每个分段内的最大值
            const segmentSize = Math.floor(audioContext.sampleRate * (SEGMENT_DURATION_MS / 1000));
            const segments = Math.floor(smoothedData.length / segmentSize);
            let validSegments = 0;
            let consecutiveValidSegments = 0; // 连续有效片段
            let maxConsecutiveValidSegments = 0; // 最大连续有效片段
            
            const segmentValues = []; // 用于调试输出
            
            for (let i = 0; i < segments; i++) {
                const start = i * segmentSize;
                const end = Math.min(start + segmentSize, smoothedData.length);
                
                let maxValue = 0;
                let avgValue = 0;
                
                for (let j = start; j < end; j++) {
                    maxValue = Math.max(maxValue, smoothedData[j]);
                    avgValue += smoothedData[j];
                }
                
                avgValue /= (end - start);
                segmentValues.push(maxValue.toFixed(3));
                
                // 判断此片段是否有有效语音
                if (maxValue > SEGMENT_THRESHOLD) {
                    validSegments++;
                    consecutiveValidSegments++;
                    maxConsecutiveValidSegments = Math.max(maxConsecutiveValidSegments, consecutiveValidSegments);
                } else {
                    consecutiveValidSegments = 0;
                }
            }
            
            // 清理资源
            audioContext.close();
            
            // 判断标准：综合考虑以下因素
            // 1. RMS值
            // 2. 峰值
            // 3. 有效片段数量
            // 4. 最大连续有效片段数
            const isValidRMS = rms > RMS_THRESHOLD;
            const isValidPeak = peakValue > 0.1; // 至少有一个强声音点
            const hasEnoughValidSegments = validSegments >= MIN_VALID_SEGMENTS;
            const hasConsecutiveSegments = maxConsecutiveValidSegments >= MIN_VALID_SEGMENTS;
            
            // 计算最终结果
            const isValidAudio = (isValidRMS && hasEnoughValidSegments) || (isValidPeak && hasConsecutiveSegments);
            
            console.log(
                '音频分析结果:',
                `大小=${(audioBlob.size/1024).toFixed(2)}KB`,
                `时长=${(audioBuffer.duration*1000).toFixed(0)}ms`,
                `峰值=${peakValue.toFixed(3)}`,
                `RMS=${rms.toFixed(4)}`,
                `有效片段=${validSegments}/${segments}`,
                `连续片段=${maxConsecutiveValidSegments}`,
                `分段值=[${segmentValues.join(', ')}]`,
                `结果=${isValidAudio ? '有效' : '无效'}`
            );
            
            return isValidAudio;
            
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
     * 生成唯一的对话ID
     * @returns {string} - 对话ID
     */
    generateDialogId() {
        return `dialog_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    }
    
    /**
     * 打断AI响应
     */
    interruptAiResponse() {
        // 如果已经处于打断状态或不在响应中，避免重复打断
        if (!this.isAiResponding || this.isInterrupting) {
            return;
        }
        
        // 设置打断标志，避免重复打断
        this.isInterrupting = true;
        
        console.log("正在打断AI响应...");
        
        // 立即结束AI响应状态
        this.isAiResponding = false;
        
        // 打断当前队列
        if (this.currentDialogId) {
            console.log(`打断当前对话队列: ${this.currentDialogId}`);
            this.queueManager.interruptCurrentQueue();
        }
        
        // 清除所有派生的请求
        if (window.activeRequests && window.activeRequests.length > 0) {
            try {
                console.log('取消当前运行的请求...');
                // 如果有AbortController，试图使用它来取消请求
                window.activeRequests.forEach(controller => {
                    if (controller && typeof controller.abort === 'function') {
                        controller.abort();
                    }
                });
                window.activeRequests = [];
            } catch (e) {
                console.error('取消请求时出错:', e);
            }
        }
        
        // 取消当前特定对话相关的请求
        if (this.currentController && typeof this.currentController.abort === 'function') {
            try {
                this.currentController.abort();
                this.currentController = null;
            } catch (e) {
                console.error('取消当前对话请求时出错:', e);
            }
        }
        
        // 清除所有可能的EventSource连接
        if (this.eventSource) {
            try {
                this.eventSource.close();
                this.eventSource = null;
            } catch (e) {
                console.error('关闭EventSource时出错:', e);
            }
        }
        
        // 清除所有相关的SSE连接
        const allEventSources = document.querySelectorAll('.event-source-container');
        if (allEventSources.length > 0) {
            allEventSources.forEach(container => {
                try {
                    if (container.eventSource) {
                        container.eventSource.close();
                    }
                    container.remove();
                } catch (e) {
                    console.error('关闭附加EventSource时出错:', e);
                }
            });
        }
        
        // 重置打断标志
        setTimeout(() => {
            this.isInterrupting = false;
        }, 1000); // 给一些时间确保系统状态稳定
        
        // 添加打断指示到UI
        try {
            if (this.messageHandler.aiMessageElement) {
                this.messageHandler.aiMessageElement.innerHTML += ' <span class="interrupt-indicator">[用户打断]</span>';
            }
            
            // 完成打字机效果
            Typewriter.finalizeTypewriter(() => {
                console.log("AI响应成功被打断");
                
                // 重置当前状态以允许新的对话开始
                setTimeout(() => {
                    if (this.isSessionActive && !this.isListening) {
                        this.startListening();
                    }
                }, 500);
            });
        } catch (e) {
            console.error('更新UI时出错:', e);
        }
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
