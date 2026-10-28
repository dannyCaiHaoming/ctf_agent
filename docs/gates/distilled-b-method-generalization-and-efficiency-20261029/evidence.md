# 通用解题方法与耗时优化：历史原始证据

以下为原设计中迁移的纯原始记录，内容原样保留；设计判断、边界与证明限制仍保留在原设计中。

## §1.1 固定资产 SHA-256

- run 固定 `opencode/config/opencode/skills/web-session-diagnosis/SKILL.md` 与当前产品文件 SHA-256 均为 `5d09095c1036d410671efc15a7afdf26b664a37218ebf8c83759346e5d83e8a3`；附属 Reference 均为 `80ead0af4b63b90523acf250efbe8d68c33ada1500fc3b89b05bf4b8733a6d90`。

## §1.1 r4 同参数 HTTP 组定位

### A：Solver 加载 Skill 之前的同参数 HTTP 组

fingerprint `8277b4618551cf5ad794214bd266457d188cff3e6d0a807f23647b96c18d4ee1`；seq 1294、1312、1330、1342、1360、1378、1390、1408；elapsedMs 438203–490279

### B：Solver 加载 Skill 后的同参数 HTTP 组

fingerprint `d413b27445de76ebc4f61c0fe92a08970e32e428e01e0b9899d70be5427484a9`；seq 2258、2270、2282、2299；elapsedMs 1062911–1071990

## §1.2 A 的五项纯逐调用记录

| GET seq／callID | 直接前提与相对变化 | 新观察及紧邻动作 |
| --- | --- | --- |
| 1294／`call_00_6d6o4kcboyshluzs0sgpxgbz` | POST 1288；变更一个业务字段 | 200，5449 B；与前一观察不同的正文，seq 1300 完整读取后改写该字段 |
| 1312／`call_00_kih4p7i68j8hle111ula2ua1` | POST 1306；同字段新值 | 200，6218 B；正文再次变化，seq 1318 完整读取，随后尝试另一输入 |
| 1342／`call_00_ima91wn0sxnfo2gzz9cc2y4n` | POST 1336；针对上一失败改值 | 200，6008 B；seq 1348 完整读取后继续改值；恢复正常页面与产生不同内容均有记录 |
| 1360／`call_00_7tk1ng5f5hwsqi8mkic1zj23` | POST 1354；同字段新值 | 200，5516 B；seq 1366 完整读取后换下一输入 |
| 1390／`call_00_shbg724ateswb1p9sblln1bl` | POST 1384；同字段新值 | 200，3870 B；seq 1396 完整读取后再改值 |

## §5.1 本次产品资产 SHA-256

本次产品资产 SHA-256：Skill v6 `0f93c48c4fc9527d47868ff3faa382e21c5fe90fcbe038159b20021bfafc217f`；Reference v1 `4ce0f4497071800e0df3291557af17df3e0c3cfd7bb98135e7c2bda94d6cda42`。
