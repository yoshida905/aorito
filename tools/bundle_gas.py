"""gas-cash/ の4ファイルを1つにまとめ、Apps Scriptに1回で貼り付けられるファイルを作る。

python3 tools/bundle_gas.py で dist/kinko.gs と docs/setup-guide.html を出力する。
"""
import html
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = ["Config.gs", "Ledger.gs", "Setup.gs", "Code.gs"]

parts = ["// 大阪GB 現金出納帳 金庫管理スクリプト(このファイル1つをApps Scriptに貼り付ける)\n"
         "// 元のファイル: gas-cash/" + "・".join(FILES) + "\n"]
for name in FILES:
    parts.append(f"\n// ===== {name} =====\n")
    parts.append((ROOT / "gas-cash" / name).read_text(encoding="utf-8"))
bundle = "".join(parts)
(ROOT / "dist" / "kinko.gs").write_text(bundle, encoding="utf-8")

template = (ROOT / "tools" / "setup-guide.template.html").read_text(encoding="utf-8")
(ROOT / "docs" / "setup-guide.html").write_text(
    template.replace("{{CODE}}", html.escape(bundle)).replace("{{LINES}}", str(bundle.count("\n") + 1)),
    encoding="utf-8")
print("saved dist/kinko.gs, docs/setup-guide.html", bundle.count("\n") + 1, "lines")
