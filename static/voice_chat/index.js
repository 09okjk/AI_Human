/**
 * 语音通话功能初始化脚本
 */

// 导入必要的模块
import VoiceChat from './core.js';
import AudioRecorder from '../audio_recorder/audio_recorder.js'; // 假设录音对话类的路径

// 等待DOM加载完成
document.addEventListener('DOMContentLoaded', () => {
    // 获取UI元素
    const startCallButton = document.getElementById('startCallButton');
    const endCallButton = document.getElementById('endCallButton');
    const statusElement = document.getElementById('voiceChatStatus');
    
    // 初始化录音对话功能和语音通话功能
    const audioRecorder = new AudioRecorder(); // 创建录音对话实例
    const voiceChat = new VoiceChat();
    
    // 将录音对话实例设置到语音通话功能中
    voiceChat.setAudioRecorder(audioRecorder);
    
    // 检查初始化状态
    if (!voiceChat.checkInitialization()) {
        console.error("语音通话功能初始化失败");
        statusElement.textContent = "语音通话功能初始化失败，请刷新页面重试";
        startCallButton.disabled = true;
        return;
    }
    
    // 绑定按钮事件
    startCallButton.addEventListener('click', async () => {
        // 禁用开始按钮，防止重复点击
        startCallButton.disabled = true;
        // 启用结束按钮
        endCallButton.disabled = false;
        
        // 开始通话
        await voiceChat.startCall();
    });
    
    endCallButton.addEventListener('click', async () => {
        // 禁用结束按钮，防止重复点击
        endCallButton.disabled = true;
        // 启用开始按钮
        startCallButton.disabled = false;
        
        // 结束通话
        await voiceChat.endCall();
    });
    
    // 监听状态更新事件
    document.addEventListener('voice-chat-status', (event) => {
        statusElement.textContent = event.detail.message;
    });
    
    // 监听UI更新事件
    document.addEventListener('voice-chat-ui-update', (event) => {
        if (event.detail.state === 'call-started') {
            startCallButton.disabled = true;
            endCallButton.disabled = false;
        } else if (event.detail.state === 'call-ended') {
            startCallButton.disabled = false;
            endCallButton.disabled = true;
        }
    });
    
    // 初始状态设置
    endCallButton.disabled = true;
    statusElement.textContent = "准备就绪，点击「开始通话」按钮开始";
    
    console.log("语音通话功能已初始化");
});
