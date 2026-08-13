# Offline two-stem separation audit

## Distributed components

| Component | Version / revision | License | Distribution source |
| --- | --- | --- | --- |
| sherpa-onnx Windows x64 C runtime | 1.13.4, `142807252687d81b40d6315f23470a1512a00de3` | Apache-2.0 | `sherpa-onnx-win-x64@1.13.4` |
| ONNX Runtime | 1.27.0, bundled by sherpa-onnx | MIT | sherpa-onnx Windows runtime |
| Koffi FFI | 3.1.2 | MIT | `koffi@3.1.2` |
| Spleeter two-stem FP16 ONNX model | HF `93ba771920ade509f8cbd6825b1a90856c797e08` | MIT | `csukuangfj/sherpa-onnx-spleeter-2stems-fp16` |

## Model provenance and integrity

The Hugging Face repository is
<https://huggingface.co/csukuangfj/sherpa-onnx-spleeter-2stems-fp16>.
The release archive is
<https://github.com/k2-fsa/sherpa-onnx/releases/download/source-separation-models/sherpa-onnx-spleeter-2stems-fp16.tar.bz2>
with SHA-256
`c6c5c4307673bc6813ddf58d4efdff57c26d2dfc3f25b05c7a32db453d70aca6`.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `vocals.fp16.onnx` | 19,681,017 | `24cef84aedcd1fe87c0b743ef3370ad34dc1fabf6c9014d6128a75a538c7b668` |
| `accompaniment.fp16.onnx` | 19,681,024 | `d14cea55793cc531a5875f5f4da08207d1c5ab9292e8e0099a104eecb014fcc0` |

k2-fsa's fixed conversion chain is documented at
<https://github.com/k2-fsa/sherpa-onnx/blob/142807252687d81b40d6315f23470a1512a00de3/scripts/spleeter/run.sh>.
The Spleeter JOSS paper states that source code and pre-trained models are
distributed under MIT: <https://doi.org/10.21105/joss.02154>.

## Runtime controls

- Inference runs offline in a helper process; no model or audio is uploaded.
- The helper explicitly preloads its bundled ONNX Runtime DLL before the
  sherpa C API, preventing accidental binding to a system DLL.
- Cancellation terminates the helper process and removes work/staging files.
- The cache key includes the model identity and immutable model digest prefix.
- Exact machine-readable provenance is shipped in
  `resources/spleeter/MODEL_MANIFEST.json`.

Full license texts ship in `resources/spleeter/licenses/`. Model licensing does
not grant rights to user-supplied music.
