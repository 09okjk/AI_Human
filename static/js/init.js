/**
 * 初始化检查脚本 - 确保所有资源正确加载
 */
(function() {
    window.addEventListener('DOMContentLoaded', function() {
        console.log('页面已加载，检查资源...');
        
        // 检查CSS样式是否加载
        const cssLoaded = Array.from(document.styleSheets).some(sheet => {
            try {
                return sheet.href && sheet.href.includes('voice-chat.css');
            } catch (e) {
                return false;
            }
        });
        
        if (!cssLoaded) {
            console.warn('警告: voice-chat.css 未正确加载！');
            // 尝试动态加载CSS
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/static/css/voice-chat.css';
            document.head.appendChild(link);
            console.log('已尝试动态加载 voice-chat.css');
        } else {
            console.log('voice-chat.css 已正确加载');
        }
        
        // 模块加载检查
        setTimeout(() => {
            if (!window.voiceChat) {
                console.error('错误: 语音通话模块未加载!');
                document.getElementById('status-message').textContent = '模块加载失败，请刷新页面';
            } else {
                console.log('语音通话模块已成功加载');
            }
        }, 500);
    });
})();
