"""金庫チェック表(週次・印刷用)のExcelを生成するスクリプト。

python3 tools/build_safe_check_sheet.py で docs/safe-check-sheet.xlsx を出力する。
"""
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.page import PageMargins

OUT = "docs/safe-check-sheet.xlsx"
FONT = "Arial"
THIN = Side(style="thin", color="000000")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HEAD_FILL = PatternFill("solid", fgColor="D9D9D9")
INPUT_FILL = PatternFill("solid", fgColor="FFF2CC")
YEN = '#,##0;[Red]-#,##0;""'  # 0は印刷時に空欄に見せる

DENOMS = [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1]


def f(size=10, bold=False, color="000000"):
    return Font(name=FONT, size=size, bold=bold, color=color)


def put(ws, ref, value=None, *, size=10, bold=False, fill=None, align="left",
        fmt=None, border=True, color="000000", wrap=False):
    c = ws[ref]
    if value is not None:
        c.value = value
    c.font = f(size, bold, color)
    c.alignment = Alignment(horizontal=align, vertical="center", wrap_text=wrap)
    if fill:
        c.fill = fill
    if fmt:
        c.number_format = fmt
    if border:
        c.border = BOX
    return c


def box_range(ws, rng, fill=None):
    for row in ws[rng]:
        for c in row:
            c.border = BOX
            if fill:
                c.fill = fill


def merge(ws, rng, value=None, **kw):
    first = rng.split(":")[0]
    box_range(ws, rng, kw.get("fill"))
    ws.merge_cells(rng)
    return put(ws, first, value, **kw)


def build_sheet(ws, example=False):
    # 列幅(A4縦・1ページに収まるよう調整)
    for col, w in zip("ABCDEFGH", [16, 11, 11, 13, 13, 12, 9, 13]):
        ws.column_dimensions[col].width = w

    title = "金庫チェック表(週次)" + ("  ※記入例" if example else "")
    merge(ws, "A1:H1", title, size=16, bold=True, align="center", border=False)
    ws.row_dimensions[1].height = 30

    # --- 基本情報 ---
    r = 3
    for label, col_l, col_v, val in [
        ("実施日", "A", "B:C", "2026/10/05(月)"),
        ("実施時刻", "D", "E:E", "18:30"),
        ("前回実施日", "F", "G:H", "2026/09/28(月)"),
    ]:
        put(ws, f"{col_l}{r}", label, bold=True, fill=HEAD_FILL, align="center")
        a, b = col_v.split(":")
        merge(ws, f"{a}{r}:{b}{r}", val if example else None, fill=INPUT_FILL,
              align="center")
    r = 4
    for label, col_l, col_v, val in [
        ("担当者(数える人)", "A", "B:C", "山田"),
        ("確認者(立会い)", "D", "E:E", "佐藤"),
        ("責任者印", "F", "G:H", None),
    ]:
        put(ws, f"{col_l}{r}", label, bold=True, fill=HEAD_FILL, align="center",
            size=9)
        a, b = col_v.split(":")
        merge(ws, f"{a}{r}:{b}{r}", val if example else None, fill=INPUT_FILL,
              align="center")
    ws.row_dimensions[4].height = 28

    # --- 1. 釣銭準備金 ---
    r = 6
    merge(ws, f"A{r}:H{r}", "1. 釣銭準備金(金種ごとに枚数を数えて記入)",
          bold=True, border=False)
    r = 7
    heads = [("A", "金種"), ("B", "枚数"), ("C", "金額(円)")]
    heads2 = [("E", "金種"), ("F", "枚数"), ("G", "金額(円)")]
    for col, h in heads + heads2:
        put(ws, f"{col}{r}", h, bold=True, fill=HEAD_FILL, align="center")
    ws.merge_cells(f"G{r}:H{r}")
    box_range(ws, f"G{r}:H{r}", HEAD_FILL)

    # 合計がちょうど100,000円になる記入例
    sample_counts = {10000: 3, 5000: 4, 2000: 0, 1000: 30, 500: 20,
                     100: 80, 50: 20, 10: 80, 5: 20, 1: 100}
    left, right = DENOMS[:5], DENOMS[5:]
    first_row = 8
    for i in range(5):
        row = first_row + i
        for denom, (dc, nc, ac, ac2) in [(left[i], ("A", "B", "C", None)),
                                         (right[i], ("E", "F", "G", "H"))]:
            label = f"{denom:,}円" + ("札" if denom >= 1000 else "玉")
            put(ws, f"{dc}{row}", label, align="center")
            put(ws, f"{nc}{row}", sample_counts[denom] if example else None,
                fill=INPUT_FILL, align="right", fmt='#,##0;-#,##0;""')
            formula = f"={denom}*{nc}{row}"
            if ac2:
                merge(ws, f"{ac}{row}:{ac2}{row}", formula, align="right", fmt=YEN)
            else:
                put(ws, f"{ac}{row}", formula, align="right", fmt=YEN)
        ws.row_dimensions[row].height = 22
    last_row = first_row + 4

    r = last_row + 2  # 14
    rows = [
        ("① 実際の合計", f"=SUM(C{first_row}:C{last_row})+SUM(G{first_row}:G{last_row})", False),
        ("② 決められた準備金の額", 100000 if example else None, True),
        ("③ 差額(①−②)", f"=IF(D{r+1}=\"\",\"\",D{r}-D{r+1})", False),
    ]
    for k, (label, val, is_input) in enumerate(rows):
        row = r + k
        merge(ws, f"A{row}:C{row}", label, bold=True, fill=HEAD_FILL)
        put(ws, f"D{row}", val, align="right", fmt=YEN, bold=True,
            fill=INPUT_FILL if is_input else None)
        ws.row_dimensions[row].height = 22
    merge(ws, f"E{r}:H{r+2}",
          "②は毎回同じ金額。事前に決めて印刷前に記入しておく。\n"
          "③が0でなければ「4. 差額があったとき」を必ず記入。",
          size=9, wrap=True, border=False, color="595959")
    ws[f"D{r}"].number_format = YEN
    ws[f"D{r+2}"].number_format = '#,##0;[Red]-#,##0;0'
    # 空欄でも0と表示させないよう、②未記入時は""を返す式にしている
    ws[f"D{r+2}"].value = f'=IF(D{r+1}="","",D{r}-D{r+1})'
    after_float = r + 2  # 16

    # --- 2. 現場売上金・預かり金 ---
    r = after_float + 2  # 18
    merge(ws, f"A{r}:H{r}",
          "2. 現場売上金・預かり金(金庫に入っている封筒を1件ずつ記入)",
          bold=True, border=False)
    r += 1
    heads = ["案件名", "区分\n売上/預り", "受取日", "帳簿の金額", "実際の金額",
             "差額", "銀行\n入金済", "入金日/返却日"]
    for col, h in zip("ABCDEFGH", heads):
        put(ws, f"{col}{r}", h, bold=True, fill=HEAD_FILL, align="center",
            size=9, wrap=True)
    ws.row_dimensions[r].height = 28
    samples = [
        ("A社 周年パーティー", "売上", "10/02", 180000, 180000, "□", ""),
        ("B様 結婚式二次会", "預り", "10/03", 50000, 49000, "□", ""),
    ]
    start = r + 1
    n_rows = 8
    for i in range(n_rows):
        row = start + i
        s = samples[i] if example and i < len(samples) else None
        put(ws, f"A{row}", s[0] if s else None, fill=INPUT_FILL, size=9)
        put(ws, f"B{row}", s[1] if s else None, fill=INPUT_FILL, align="center", size=9)
        put(ws, f"C{row}", s[2] if s else None, fill=INPUT_FILL, align="center", size=9)
        put(ws, f"D{row}", s[3] if s else None, fill=INPUT_FILL, align="right", fmt=YEN)
        put(ws, f"E{row}", s[4] if s else None, fill=INPUT_FILL, align="right", fmt=YEN)
        put(ws, f"F{row}", f'=IF(OR(D{row}="",E{row}=""),"",E{row}-D{row})',
            align="right", fmt='#,##0;[Red]-#,##0;0')
        put(ws, f"G{row}", s[5] if s else "□", align="center")
        put(ws, f"H{row}", s[6] if s else None, fill=INPUT_FILL, align="center", size=9)
        ws.row_dimensions[row].height = 22
    end = start + n_rows - 1
    tot = end + 1
    merge(ws, f"A{tot}:C{tot}", "合計", bold=True, fill=HEAD_FILL, align="center")
    for col in "DE":
        put(ws, f"{col}{tot}", f"=SUM({col}{start}:{col}{end})", bold=True,
            align="right", fmt=YEN)
    put(ws, f"F{tot}", f'=IF(COUNT(E{start}:E{end})=0,"",E{tot}-D{tot})',
        bold=True, align="right", fmt='#,##0;[Red]-#,##0;0')
    merge(ws, f"G{tot}:H{tot}", None)
    ws.row_dimensions[tot].height = 22

    # --- 3. 確認項目 ---
    r = tot + 2
    merge(ws, f"A{r}:H{r}", "3. 確認項目(はい/いいえ に○)", bold=True, border=False)
    checks = [
        "受取日から7日以上たっている売上金はない(あれば今日入金する)",
        "預かり金の返却・精算の期限を過ぎているものはない",
        "封筒すべてに案件名・金額・受取者名が書いてある",
        "前回のチェック表の差額・対応事項はすべて解決している",
        "金庫の鍵・暗証番号は決められた人だけが管理している",
        "チェック後に金庫を施錠し、2人で施錠を確認した",
    ]
    for i, text in enumerate(checks):
        row = r + 1 + i
        merge(ws, f"A{row}:F{row}", f"□ {text}", size=9)
        merge(ws, f"G{row}:H{row}", "はい ・ いいえ", align="center", size=9)
        ws.row_dimensions[row].height = 20
    r = r + 1 + len(checks)

    # --- 4. 差額があったとき ---
    r += 1
    merge(ws, f"A{r}:H{r}",
          "4. 差額があったとき(1円でも差があれば記入し、当日中に責任者へ報告)",
          bold=True, border=False)
    items = [
        ("考えられる原因", "B様預り金:当日のキャンセル料1,000円を現金で返金、記録漏れ"),
        ("対応内容", "B様への返金記録を追記し帳簿を修正。封筒に返金メモを同封"),
        ("責任者への報告", "10/05 19:00 田中店長へ口頭報告済み"),
    ]
    for i, (label, sample) in enumerate(items):
        row = r + 1 + i
        put(ws, f"A{row}", label, bold=True, fill=HEAD_FILL, align="center", size=9)
        merge(ws, f"B{row}:H{row}", sample if example else None, fill=INPUT_FILL,
              size=9, wrap=True)
        ws.row_dimensions[row].height = 30

    # 印刷設定
    last = r + len(items)
    ws.print_area = f"A1:H{last}"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins = PageMargins(left=0.5, right=0.5, top=0.6, bottom=0.6)
    ws.print_options.horizontalCentered = True
    ws.oddFooter.center.text = "黄色の欄を記入。記入後は1年間保管(ファイルに綴じる)"
    ws.oddFooter.center.size = 8
    ws.sheet_view.showGridLines = False


def build_guide(ws):
    ws.column_dimensions["A"].width = 100
    lines = [
        ("金庫チェック表の使い方", True),
        ("", False),
        ("1. 「チェック表」シートを印刷する(A4縦1枚)。記入例は「記入例」シート。", False),
        ("2. 印刷前に「② 決められた準備金の額」だけは毎回同じ金額を入れておく。", False),
        ("3. 週1回、決めた曜日・時刻に、担当者と確認者の2人で金庫を開けて数える。", False),
        ("4. 黄色の欄だけ記入する。白い欄は計算欄(Excelで入力すると自動計算、手書きなら電卓で計算)。", False),
        ("5. 差額が1円でもあれば「4. 差額があったとき」を書き、当日中に責任者へ報告する。", False),
        ("6. 記入した紙は責任者が押印し、ファイルに綴じて1年間保管する。", False),
        ("", False),
        ("運用ルール(推奨)", True),
        ("・現場で受け取った売上金は、週1回のチェックを待たず受取から翌営業日までに銀行へ入金する。", False),
        ("・金庫から現金を出し入れするときは、封筒に日付・金額・名前を書いたメモを入れる。", False),
        ("・担当者は毎週同じ人にしない(交代制にすると、ミスや不正に気づきやすい)。", False),
    ]
    for i, (text, bold) in enumerate(lines, start=1):
        c = ws.cell(row=i, column=1, value=text)
        c.font = f(14 if bold and i == 1 else 11, bold)
        c.alignment = Alignment(wrap_text=True, vertical="center")
    ws.sheet_view.showGridLines = False


wb = Workbook()
guide = wb.active
guide.title = "使い方"
build_guide(guide)
build_sheet(wb.create_sheet("チェック表"))
build_sheet(wb.create_sheet("記入例"), example=True)
wb.active = 1
wb.save(OUT)
print("saved", OUT)
