# AI 语音对话系统

这是一个基于前后端分离架构的实时语音对话系统，使用 Flask 作为后端 API 服务，HTML/CSS/JavaScript 作为前端界面。该系统通过调用 Qwen-Omni 模型 API 实现语音识别和语音生成功能。

## 系统要求

- Ubuntu 22.04
- Python 3.8+
- 网络连接
- 百炼 API Key (DASHSCOPE_API_KEY)

## 安装指南

### 1. 克隆或下载代码到 Ubuntu 服务器

```bash
# 如果使用 Git
git clone <repository-url> AI_Human
cd AI_Human

# 或者手动上传项目文件到服务器
```

### 2. 安装依赖

首先安装系统依赖：

```bash
# 安装 PyAudio 依赖
sudo apt-get update
sudo apt-get install -y python3-pip python3-dev portaudio19-dev
```

然后安装 Python 依赖：

```bash
pip3 install -r requirements.txt
```

### 3. 配置环境变量

创建 `.env` 文件或设置环境变量：

```bash
# 创建 .env 文件
echo "DASHSCOPE_API_KEY=your_api_key_here" > .env

# 或者直接设置环境变量
export DASHSCOPE_API_KEY=your_api_key_here
```

## 运行应用

### 启动后端服务

```bash
python3 app.py
```

服务将在 `http://0.0.0.0:5000` 上运行，可以在局域网内通过服务器 IP 地址访问。例如：`http://192.168.1.100:5000`

## 使用说明

1. 在浏览器中访问应用（使用服务器的 IP 地址）
2. 点击麦克风按钮开始录音（需要授予麦克风权限）
3. 再次点击麦克风按钮结束录音并发送
4. 或者在文本框中输入消息并点击发送按钮
5. 等待 AI 回复，系统将自动播放语音回复

## 技术说明

- 后端：Flask
- 前端：HTML, CSS, JavaScript (原生)
- API：Qwen-Omni 模型 API
- 音频处理：Web Audio API, MediaRecorder API

## 故障排除

1. 如果遇到麦克风访问问题：
   - 确保浏览器已授予麦克风权限
   - 尝试使用 HTTPS 连接（或在本地网络中使用）

2. 如果遇到音频播放问题：
   - 检查浏览器是否支持 Web Audio API
   - 确保音频设备正常工作

3. 如果遇到 API 连接问题：
   - 验证 API 密钥是否正确
   - 检查网络连接是否正常
