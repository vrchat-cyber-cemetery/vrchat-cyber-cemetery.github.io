# SDK能力核验：原子图文包

核验日期：2026-10-03。方法：Context7、Unity／VRChat官方文档、官方SDK包静态Graph注册与wrapper检查。未启动Unity、未编译Udon脚本、未运行VRChat客户端。

## 1. 被检查的包

- `com.vrchat.worlds`，版本 `3.10.5`。
- [官方VPM索引](https://vrchat.github.io/packages/index.json)与[官方发布包](https://github.com/vrchat/packages/releases/download/3.10.5/com.vrchat.worlds-3.10.5.zip)。
- 索引与本地SHA-256一致：`51fbd4812ca9216b91d4a242319f8a29058222f2819ecebc3bce086093ffda7c`。
- 检查 `VRC.Udon.Graph.dll`、`VRC.Udon.VRCGraphModules.dll`、`VRC.Udon.Wrapper.dll`、`VRC.Udon.VRCWrapperModules.dll`。仅解压到临时目录，未提交SDK本体或安装Unity。

## 2. 确认注册的方法

| 能力 | Graph注册标识 |
| --- | --- |
| 原始响应字节 | `VRCSDK3StringLoadingIVRCStringDownload.__get_ResultBytes__SystemByteArray` |
| 指定格式创建纹理 | `UnityEngineTexture2D.__ctor__SystemInt32_SystemInt32_UnityEngineTextureFormat_SystemBoolean__UnityEngineTexture2D` |
| 装载原始纹理数据 | `UnityEngineTexture2D.__LoadRawTextureData__SystemByteArray__SystemVoid` |
| 上传并释放CPU纹理副本 | `UnityEngineTexture2D.__Apply__SystemBoolean_SystemBoolean__SystemVoid` |
| 原生区间复制 | `SystemArray.__Copy__SystemArray_SystemInt32_SystemArray_SystemInt32_SystemInt32__SystemVoid` |
| UTF-8对象 | `SystemTextEncoding.__get_UTF8__SystemTextEncoding` |
| 只解码JSON区间 | `SystemTextEncoding.__GetString__SystemByteArray_SystemInt32_SystemInt32__SystemString` |
| 释放自建纹理 | `UnityEngineObject.__Destroy__UnityEngineObject__SystemVoid` |

本次在Graph注册中逐项查到上述8项，在wrapper中核对相应方法名；这比“普通Unity支持所以Udon应该支持”更强，但仍不是运行成功的证明。

## 3. 官方语义与设计推导

- ResultBytes提供原始下载字节副本，二进制包不使用整文件UTF-8字符串。[String Loading](https://creators.vrchat.com/worlds/udon/string-loading/)
- LoadRawTextureData需要与尺寸、格式及mip布局相符的原始数据，不能直接传PNG／JPEG容器。[Unity 2022.3](https://docs.unity3d.com/2022.3/Documentation/ScriptReference/Texture2D.LoadRawTextureData.html)
- DXT1／BC1为4bit每像素的RGB压缩格式，2048²单mip据此为2MiB。[DXT1](https://docs.unity3d.com/2022.3/Documentation/ScriptReference/TextureFormat.DXT1.html)
- Apply的makeNoLongerReadable参数可以释放CPU纹理副本；GPU上传仍有开销。[Apply](https://docs.unity3d.com/2022.3/Documentation/ScriptReference/Texture2D.Apply.html)
- 离线编码可用Microsoft DirectXTex的texconv生成BC1 DDS，`-m 1`抑制mip；提取块数据和色彩方向仍需生成器校验。[texconv](https://github.com/microsoft/DirectXTex/wiki/Texconv)

未发现本次检查范围内SystemInfo.SupportsTextureFormat的Udon注册，不把它作为运行时前提；不依赖ImageConversion.LoadImage、下载图CPU可读性或GPU回读。限定已验收的Windows目标。

## 4. 后续集成证明

1. 编译最小Udon脚本，使用准确重载。
2. 从Pages下载包含零字节和非UTF-8值的测试包，确认ResultBytes保真。
3. 装载已知颜色／角标的2048BC1图，确认方向、色彩和头显显示。
4. 交替旧／新包并重复释放，验证拒旧、纹理生命周期和实机性能。

这是明确的集成验收，不再是寻找未知图片校验API；未执行前不得报告客户端功能完成。
