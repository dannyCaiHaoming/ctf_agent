# Engineer 文檔增量修正

僅改 `product/opencode/agents/engineer.md` 固定產物段：自己發布限本會話文件／job；Solver 的 HTTP 由 Solver 發布，Engineer 只讀已交回 ref，禁止使用他人 HTTP resource 發布。權限／產品邏輯未改。

before/after 正文、差異與增量 hash 單獨保存；原 final-manifest 及全部既有驗收證據不改。原生舊 inventory 已確認載入舊正文；當前源正文已核對，既有 launcher 仍按原路徑逐 bytes 複製。未啟動新 runtime，因此不聲稱新正文已在新 provider 請求中觀察到。主 session 負責修改後四產物／H7 復跑與實際載入確認。本輪未重跑測試、未 commit／merge、未真實模型調用，主區只讀。
