### 5.5 作業網路 scope（候選驗證中）

現有 JobManager 直接在宿主 spawn，不建立 network namespace，也不配置出口拒絕；`http.request` 的 origin 核實不能限制 curl、Python socket 或直接 TCP／UDP。現有產品不能宣稱作業已受 scope 限制。

本項只比較下列候選，不預先選定：

- **甲：獨立會話 network namespace，預設拒絕出口。** 可信啟動器在作業開始前設置 IPv4／IPv6 OUTPUT 預設 DROP，只開可信 scope 固定的 IP、協議、端口；作業非 root、無 NET_ADMIN／NET_RAW、不可取得 Docker socket。DNS 僅走固定本地 resolver 或固定名稱表，不任由 DNS 擴大目的地；角色無目標網路時不開規則。規則建置失敗不得啟動作業。容器／namespace 的外部佈建權限與現有非 root 產品如何接合尚未定。
- **乙：受管代理出口。** 代理按題限制 HTTP origin；先測只有 proxy 環境的直連繞過，再測由 namespace 僅允許代理 socket 的組合。若組合阻斷普通 socket 到授權 TCP／UDP，就不能當作通用作業網路方案；可保留作 HTTP 的補充。

必須同時驗正向目標與越界目的地（他題、控制替身、宿主 gateway／loopback、未授權地址），覆蓋 curl、Python socket、TCP、UDP、IPv6、DNS 與清除／繞過 proxy。拒絕結果須與可達的非秘密服務對照及服務端日誌核對。DNS 變更、redirect 和共享 IP／origin 分別核實：IP/port 規則不自動等於 URL origin 規則，同 origin 的管理路徑也不能靠 IP/port 辨識。

結果去向：甲若直連與正向同時成立，只能確認封包層機制在該環境可行；地址／origin 契約或佈建未解仍留未定。乙若可繞過即淘汰獨立使用；若只支援 HTTP，明記協議限制。瀏覽器未執行路徑不宣稱覆蓋，也不把本地 fixture 通過當作通用產品隔離成立。

