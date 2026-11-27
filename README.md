# FishViewer

FishViewer 是机器鱼项目的本地网页上位机，包含串口助手、姿态与舵机控制、MagTail 控制，以及大恒相机预览和录像。网页由 Python 服务提供；串口通过浏览器的 Web Serial API 连接，工业相机通过运行服务的电脑上的大恒 Galaxy SDK 连接。

## Prerequisites

- Windows 10/11 和 Python 3.10 或更新版本。
- 支持 Web Serial 的桌面版 Chrome 或 Edge。串口功能请通过本机 `localhost` 页面使用。
- 需要使用相机时，在**连接相机并运行 `web_server.py` 的电脑**上安装[大恒图像 Galaxy Windows SDK](https://en.daheng-imaging.com/index.php?a=lists&c=index&catid=59&m=content&sylx=23&syxj=44)。安装时选择 **USB3 Vision** 相机接口。项目中的 `gxipy/` 是 Python 接口代码，不能代替 SDK、相机驱动及其 `GxIAPI.dll`。本项目使用的相机型号为 **MER-132-43U3C**。
- 按实际使用情况连接开发板串口和相机；不使用相机时，串口页面不需要相机硬件。

## Quick Start

在项目目录下执行：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe web_server.py --open
```

如果没有自动打开浏览器，请访问 `http://localhost:8000/`。停止服务时在终端按 `Ctrl+C`。

首次使用大恒相机时，先打开随 Galaxy SDK 安装的 Galaxy Viewer，确认它能识别并采集相机图像，然后关闭 Galaxy Viewer，再在 FishViewer 的第三页选择并打开相机。

## Features

| 页面 | 功能 |
| --- | --- |
| 第一页 | IMU 三维姿态显示、舵机角度控制、串口收发与快捷指令 |
| 第二页 | MagTail 运行模式、占空比与往复频率设置、电流 ADC 原始值回传、独立串口连接 |
| 第三页 | 大恒相机选择与预览、截取图像、录像及存储路径设置、曝光、增益、白平衡和采集帧率设置 |

相机参数以实际连接设备的 SDK 能力为准。录像期间相机参数和存储路径不能修改。截图和录像会自动保存到设置的文件夹，默认是项目下的 `output/`，文件名使用保存时的系统时间。

## Repository Structure

```text
FishViewer/
├── index.html          # 网页入口与三个页面
├── styles.css          # 页面样式
├── js/                 # 串口、姿态、MagTail、相机及页面交互
├── models/             # 三维模型
├── vendor/             # 前端库
├── gxipy/              # 大恒相机 Python 接口
├── camera_backend.py   # 相机采集、参数设置与录像
├── web_server.py       # 本地网页服务和相机 API
├── data/               # 页面配置数据
└── requirements.txt    # Python 依赖
```

## Usage Notes

- `requirements.txt` 安装 NumPy 和 OpenCV；Galaxy SDK 需单独安装，不能通过 `pip` 安装。
- 默认服务地址为 `127.0.0.1:8000`。可通过 `--host` 和 `--port` 修改监听地址和端口；从其他电脑访问普通 HTTP 地址时，浏览器的 Web Serial 功能可能不可用。
- 每台需要直接连接相机的电脑都需要安装相机 SDK。“存储路径设置”中的文件夹选择窗口会在运行 `web_server.py` 的电脑上打开。
