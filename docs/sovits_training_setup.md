# GPT-SoVITS v2 訓練機 setup 指南

從新機器到能跑「文字 → 你聲音的中文 mp3」的完整路徑。

## 訓練機規格需求

| 元件 | 最低 | 建議 |
|---|---|---|
| OS | Ubuntu 20.04+ / Windows 10+ / macOS 13+ | Ubuntu 22.04 |
| GPU | NVIDIA 6GB VRAM (推論) | NVIDIA RTX 3090 / 4090 (訓練 < 1 hr) |
| CPU | 4 核 | 8 核以上 |
| RAM | 16 GB | 32 GB |
| 磁碟 | 30 GB 空閒 | 50 GB |
| Python | 3.9 | 3.10 |
| CUDA | 11.8 | 12.1 |

**Apple Silicon (M2/M3)** 也能跑（用 PyTorch MPS backend），但比 CUDA 慢 3-5 倍且部分 op 還沒完整支援。
**純 CPU** 不建議——光訓練就要 24 小時起跳。

## 一、環境裝設

```bash
# 1. clone 官方 repo
git clone https://github.com/RVC-Boss/GPT-SoVITS.git
cd GPT-SoVITS
git checkout v2  # 或最新穩定 tag

# 2. 建 conda 環境
conda create -n sovits python=3.10 -y
conda activate sovits

# 3. 安裝 PyTorch（CUDA 12.1 例子；其他版本請查 pytorch.org）
pip install torch==2.1.0 torchaudio==2.1.0 --index-url https://download.pytorch.org/whl/cu121

# 4. 安裝其他依賴
pip install -r requirements.txt

# 5. 下載預訓練模型權重（約 2GB）
bash scripts/install_models.sh
# 或手動：到 huggingface.co/lj1995/GPT-SoVITS 下載 pretrained_models/ 整個資料夾
```

## 二、把錄音資料導入

承上 `sovits_recording_script_zh.md` 切片完成後，目錄結構如下：

```
~/sovits_data/
└── ferdinand_voice/
    ├── audio/
    │   ├── 001.wav      ← 切片後的單句 WAV (3-10 秒)
    │   ├── 002.wav
    │   └── ...
    └── transcript.list  ← 每行：audio_path|speaker_name|language|text
```

`transcript.list` 範例（**注意分隔符是 `|` 不是空白**）：

```
audio/001.wav|ferdinand|zh|你今天早上吃什麼了？
audio/002.wav|ferdinand|zh|我等等要去買杯咖啡你要不要一起？
audio/003.wav|ferdinand|zh|這家店的鍋貼真的很好吃皮脆內餡多汁。
```

**規則**：
- `audio_path` 是相對 `transcript.list` 的路徑
- `speaker_name` 全部一樣即可（單人模型）
- `language` 中文一律寫 `zh`
- `text` 不要有 `|` 字元；標點可保留也可去除（保留會學到斷句語氣）

## 三、訓練

GPT-SoVITS 的訓練分兩階段，都要跑：

```bash
cd GPT-SoVITS
conda activate sovits

# stage 1: SoVITS（聲學模型 — 學音色）
python train_sovits.py \
    --config configs/sovits_v2.json \
    --data_dir ~/sovits_data/ferdinand_voice \
    --transcript transcript.list \
    --output_dir ./output/ferdinand/sovits \
    --batch_size 4 \
    --epochs 8

# stage 2: GPT（韻律模型 — 學節奏／語氣）
python train_gpt.py \
    --config configs/gpt_v2.json \
    --sovits_ckpt ./output/ferdinand/sovits/G_latest.pth \
    --data_dir ~/sovits_data/ferdinand_voice \
    --transcript transcript.list \
    --output_dir ./output/ferdinand/gpt \
    --batch_size 4 \
    --epochs 15
```

**訓練時間參考（5 分鐘錄音、RTX 3090）**：
- SoVITS：~25 分鐘
- GPT：~45 分鐘

**Loss 收斂判斷**：
- SoVITS train_loss < 2.5、val_loss < 3.0 → 可用
- GPT train_loss < 4.5、val_loss < 5.0 → 可用
- 過擬合徵兆：val_loss 連續 3 epoch 上升，立刻停（已有的 ckpt 拿去推論就好）

## 四、推論（產生 mp3）

訓練好的兩個 ckpt + 一段 reference wav 就能合成任意中文：

```bash
# 自己錄一段 5-10 秒「平穩朗讀」的 reference，例如念第 17 句「早安，今天的天氣真不錯。」
# 存成 ~/sovits_data/ferdinand_voice/reference.wav

python inference_cli.py \
    --sovits_ckpt ./output/ferdinand/sovits/G_latest.pth \
    --gpt_ckpt   ./output/ferdinand/gpt/G_latest.pth \
    --ref_audio  ~/sovits_data/ferdinand_voice/reference.wav \
    --ref_text   "早安，今天的天氣真不錯。" \
    --target_text "拉丁字根 ad 朝向加 locare 放置，意思是把資源移放到特定位置以供專門使用。" \
    --output     /tmp/test_synth.wav

# 試聽 OK 之後 batch 模式
python inference_cli.py --batch --input_jsonl ./batch_input.jsonl --output_dir ./output/audio/
```

`batch_input.jsonl` 每行格式：
```json
{"id": "abandon", "text": "拉丁字根 ab 離開加 bandon 控制，意思是放棄掌控。"}
{"id": "acquire", "text": "拉丁字根 ad 朝向加 quaerere 尋求，主動取得。"}
```

## 五、整合到 Ferdinand TOEIC pipeline

訓練好後，**把模型權重 + reference 三個檔案** copy 回 Ferdinand 主機：

```
ferdinand_voice_v1/
├── sovits.pth      (~150 MB)
├── gpt.pth         (~150 MB)
└── reference.wav   (~500 KB)
```

放到 `/workspace/Ferdinand/models/voice/` （加進 `.gitignore` 不上版控）。

之後我這邊會寫一個 `scripts/gen_zh_audio.py`：
- 讀 `data/toeic/cards.jsonl` 抽 zh-TW 解釋／助記欄位
- 對每張卡呼叫 GPT-SoVITS 推論（本機 GPU）
- 把產出 mp3 上傳到 anki_server 的 `/api/media`
- 回填 `Audio` 欄位 `[sound:abandon_zh.mp3]`

整合的細節等你訓練完、模型權重就位再做。

## 六、常見地雷

1. **轉寫錯誤** → 訓練時 loss 卡死或語音怪
   - 修法：每個切片人工聽過一次校對
2. **錄音裡有背景音樂／空調風扇** → 模型學去背景而不是聲音
   - 修法：重錄。降噪不要過頭（RX De-noise 用 30% 以下）
3. **切片頭尾沒留靜音** → 推論時開頭爆音
   - 修法：用 ffmpeg 補 0.3s 靜音 `-af "adelay=300|300,apad=pad_dur=0.3"`
4. **採樣率不一致** → 訓練拒絕載入或聲音變調
   - 修法：所有 wav 統一 32kHz mono：`for f in *.wav; do sox $f -r 32000 -c 1 fixed/$f; done`
5. **Reference 音檔長度 > 10 秒** → 推論時記憶體炸
   - 修法：reference 嚴格 3-10 秒，挑語氣最平穩的一段
6. **Conda 環境裝錯 PyTorch** → CUDA out of memory 或 op not implemented
   - 修法：照官方 README 推薦的 PyTorch + CUDA 組合，**不要混 nightly**

## 參考資源

- 官方 repo：https://github.com/RVC-Boss/GPT-SoVITS
- 官方 wiki（訓練超參調整）：https://github.com/RVC-Boss/GPT-SoVITS/wiki
- 預訓練模型：https://huggingface.co/lj1995/GPT-SoVITS
- 推論性能調優：FlashAttention 2 + bf16 可再快 1.5x
