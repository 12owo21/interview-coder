# 虚拟机 OCR 服务

独立的 CPU OCR 服务：RapidOCR + ONNX Runtime，内置中文 PP-OCRv4 模型，通过 HTTP 返回文字和文字框。模型在镜像内，识别时不调用外部 AI，也不下载模型。当前尚未接入 Electron 做题流程。

## 访问

- 虚拟机部署目录：`/opt/assessment-ocr`
- 健康检查：<http://192.168.100.128:8000/health>
- 交互文档：<http://192.168.100.128:8000/docs>
- 识别接口：`POST http://192.168.100.128:8000/ocr`
- 密钥保存在虚拟机 `/opt/assessment-ocr/.env` 的 `OCR_API_KEY`，该文件仅 root 可读写。登录虚拟机查看后，在文档页面的 **Authorize** 中填入密钥即可上传图片测试。

请求使用 `multipart/form-data`，文件字段名为 `file`，密钥通过 `X-API-Key` 请求头传递。PNG、JPEG、BMP、WEBP 均可，文件最多 10 MiB、像素最多 2000 万。

在虚拟机终端测试（已放置一张合成中文测试图，也可替换为实际截图）：

```sh
cd /opt/assessment-ocr
set -a
. ./.env
set +a
curl --fail-with-body http://192.168.100.128:8000/ocr \
  -H "X-API-Key: $OCR_API_KEY" \
  -F "file=@/opt/assessment-ocr/sample.png"
```

CentOS 7 系统自带的旧版 curl 若不支持 `--fail-with-body`，改成 `--fail` 即可。服务供当前局域网调试使用，HTTP 不加密；不要直接发布到公网。

## 坐标约定

返回字段：

```json
{
  "requestId": "请求标识",
  "imageSha256": "上传图片内容的 SHA-256",
  "imageSize": {"width": 2560, "height": 1600},
  "coordinateSpace": "input-image",
  "regions": [{
    "text": "下一步",
    "score": 0.98,
    "points": [[100,200],[180,200],[180,230],[100,230]],
    "box": {"left":100,"top":200,"right":180,"bottom":230}
  }],
  "elapsedMs": 520
}
```

以上数字仅为接口示例。`points` 是文字四边形，`box` 是其外接矩形，单位为**上传图片的像素**。即使引擎内部缩放图片，也会将坐标映射回上传图片；这些坐标还不是操作系统桌面坐标。

后续接入时必须保存本次截图的实际尺寸、裁剪偏移、所属显示器及缩放信息。例如上传 1707×1067 的整屏图片，对应 2560×1600 的物理屏幕，分别按 `2560/1707` 和 `1600/1067` 换算 x、y，再处理显示器原点与裁剪偏移；不要写死 1.5 倍。最终还要符合项目点击服务使用的坐标空间。

OCR 提供文字位置，不判断正确答案，不保证文字中心就是可点击控件中心。接入时需要把 AI 返回的选项文本匹配到 OCR 文字框，再处理跨行文本、重复文本和文字旁的单选框。低置信度或匹配歧义应暂停点击，避免使用猜测坐标。

## 资源和错误处理

一个进程、一次推理处理一张图片；并发推理返回 `429`，客户端稍后重试。空白图片返回 `200` 和空 `regions`。

| 情况 | HTTP 状态 |
| --- | --- |
| 缺少或错误密钥 | 401 |
| 空文件、无法解码或不支持的图片 | 400 |
| 文件或图片像素超限 | 413 |
| 缺少 `file` 字段 | 422 |
| 正在识别另一张图片 | 429 |
| 推理内部失败 | 500 |

容器限制为 1.5 个 CPU、2 GiB 内存（不是预占内存），单 worker，推理线程数 2。根文件系统只读，临时目录 128 MiB，使用非 root 用户运行。镜像内的 `/app/installed-requirements.txt` 记录实际安装版本。

## 本次部署验证

虚拟机实际配置为 2 核、约 8 GiB 内存。已从 Windows 宿主机调用接口，不只是容器内部自测。具体响应保存于 `verification.json`，安装版本保存在 `installed-requirements.txt`。

- 2560×1600 和 1707×1067 两张合成中文截图：均正确识别题干、A/B/C/D 选项和“下一步”，各文字框中心均落在预期文字区域内，返回尺寸与上传尺寸一致。
- 首次大图识别约 8.43 秒，小图约 1.93 秒；重启后大图约 4.19 秒。这里只是少量样本，不能作为稳定延迟保证。
- 空白图返回空数组；无效密钥、无效图片、空文件、超过 10 MiB 文件分别返回预期状态；同时发出两次请求得到一次 200、一次 429。
- 启动后内存约 85 MiB，识别后约 628 MiB；包含并发与超大文件测试的容器 cgroup 内存峰值约 1016 MiB。2 GiB 是上限，并非固定占用；真实截图和长期运行的占用还需持续观察。
- 镜像解压体积约 727 MiB。健康检查正常，重启 OCR 容器后仍可识别，文档页面可访问。Docker 已启用开机启动；未实际重启整台虚拟机。
- 原有 PostgreSQL 容器保持运行。无需修改防火墙或 Docker 全局镜像源。

这些测试验证了部署可用性和合成图的坐标返回，尚未验证实际测评网站的识别准确率，也没有执行自动点击。

## 运维

```sh
cd /opt/assessment-ocr
docker compose ps
docker compose logs --tail 100 ocr
docker stats --no-stream assessment-ocr
docker compose restart ocr
docker compose stop ocr
docker compose up -d
```

配置了 `restart: unless-stopped`：Docker 启动后自动恢复未手动停止的容器。镜像更新用 `docker compose up -d --build`。这些命令只管理 OCR 服务，不要为此重启 Docker 或其他数据库容器。

## 在其他机器部署

将此目录复制到服务器，修改 `compose.yaml` 的端口绑定 IP（当前绑定 `192.168.100.128`），生成 `.env` 后启动：

```sh
umask 077
printf 'OCR_API_KEY=%s\n' "$(openssl rand -hex 32)" > .env
docker compose up -d --build
```

此次虚拟机访问 Docker Hub 超时，使用官方公共 ECR 镜像来源，在 `.env` 中增加了：

```dotenv
PYTHON_IMAGE=public.ecr.aws/docker/library/python:3.10-slim-bookworm
```

没有修改 Docker 全局镜像源配置。构建需要联网下载依赖；构建完成后推理不依赖外网。服务 API 不依赖客户端语言，Electron/TypeScript 可直接上传截图，不需要在客户电脑安装 Python。
