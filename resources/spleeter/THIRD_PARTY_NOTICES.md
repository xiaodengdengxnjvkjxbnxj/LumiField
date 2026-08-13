# Offline stem-separation notices

LumiField distributes the following components for local, offline two-stem
separation:

- sherpa-onnx 1.13.4 C runtime, Apache-2.0.
- ONNX Runtime 1.27.0, MIT.
- Koffi 3.1.2, MIT.
- Deezer Spleeter two-stem pre-trained model converted to FP16 ONNX by
  sherpa-onnx, MIT.

The exact sources, immutable revisions, file sizes and SHA-256 digests are in
`MODEL_MANIFEST.json`. The Spleeter authors state that both source code and
pre-trained models are distributed under the MIT license in
<https://doi.org/10.21105/joss.02154>. The model conversion provenance is
<https://github.com/k2-fsa/sherpa-onnx/blob/142807252687d81b40d6315f23470a1512a00de3/scripts/spleeter/run.sh>.

License texts are included in the `licenses` directory. These licenses cover
the software and model; they do not grant rights to music supplied by users.
