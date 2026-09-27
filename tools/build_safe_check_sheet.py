"""現金出納帳 兼 金庫確認表(週1枚・印刷用)のExcelを生成するスクリプト。

python3 tools/build_safe_check_sheet.py で docs/safe-check-sheet.xlsx を出力する。

考え方:
- 入金と出金を別の列に書く(▲の付け忘れで入出金が分からなくなるのを防ぐ)
- 週の終わりに「帳簿の残高」と「実際に数えた金額」を比べる
- 基準額(10万円)を超えた分は銀行へ入金し、毎週10万円から始める
"""
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.page import PageMargins

OUT = "docs/safe-check-sheet.xlsx"
FONT = "Arial"
BASE_AMOUNT = 100000  # 金庫に置いておく基準額(毎週この額から始める)
DENOMS = [10000, 5000, 1000, 500, 100, 50, 10, 5, 1]  # 2,000円札は使わない
LOG_ROWS = 18  # 1週間分の記入行数(9月実績は月30件前後=週8件程度)

THIN = Side(style="thin", color="000000")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HEAD_FILL = PatternFill("solid", fgColor="D9D9D9")
INPUT_FILL = PatternFill("solid", fgColor="FFF2CC")
YEN = '#,##0;[Red]-#,##0;""'  # 0は印刷時に空欄に見せる
YEN_DIFF = '#,##0;[Red]-#,##0;0'  # 差額は0も表示する

# 記入例(9月の実際の記入内容をもとに作成。取引先・担当者名は仮名)
EXAMPLE_LOG = [
    # 日付, 区分, 内容, 担当, 入金, 出金, レシート
    ("9/1", "買", "コインランドリー", "山田", None, 500, "✓"),
    ("9/2", "売", "A社 ケータリング代", "佐藤", 30000, None, "―"),
    ("9/2", "買", "氷", "鈴木", None, 308, "✓"),
    ("9/3", "買", "コインランドリー", "山田", None, 1300, "✓"),
    ("9/3", "買", "消耗品(ドラッグストア)", "田中", None, 9240, "✓"),
    ("9/4", "売", "B社 オードブル代", "佐藤", 44400, None, "―"),
    ("9/5", "買", "業務スーパー", "山田", None, 594, "✓"),
    ("9/6", "買", "駐車場代", "鈴木", None, 600, "✓"),
]
EXAMPLE_COUNTS = {10000: 12, 5000: 4, 1000: 15, 500: 8, 100: 20,
                  50: 10, 10: 30, 5: 8, 1: 18}  # 合計161,858円


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


def merge(ws, rng, value=None, **kw):
    first = rng.split(":")[0]
    if kw.get("border", True):
        for row in ws[rng]:
            for c in row:
                c.border = BOX
                if kw.get("fill"):
                    c.fill = kw["fill"]
    ws.merge_cells(rng)
    return put(ws, first, value, **kw)


def build_sheet(ws, example=False):
    # A:日付 B:区分 C:内容 D:担当 E:入金 F:出金 G:レシート H:確認
    for col, w in zip("ABCDEFGH", [8, 9, 30, 9, 12, 12, 8, 8]):
        ws.column_dimensions[col].width = w

    title = "現金出納帳 兼 金庫確認表(週1枚)" + ("  ※記入例" if example else "")
    merge(ws, "A1:H1", title, size=15, bold=True, align="center", border=False)
    ws.row_dimensions[1].height = 28

    # --- 期間と繰越 ---
    put(ws, "A3", "期間", bold=True, fill=HEAD_FILL, align="center")
    merge(ws, "B3:C3", "2026/9/1(月)〜 9/7(日)" if example else "     /     (  )〜     /     (  )",
          fill=INPUT_FILL, align="center")
    merge(ws, "D3:E3", "先週からの繰越", bold=True, fill=HEAD_FILL, align="center")
    merge(ws, "F3:G3", BASE_AMOUNT, bold=True, align="right", fmt=YEN)
    put(ws, "H3", "円", border=False)
    ws.row_dimensions[3].height = 22
    carry = "F3"

    # --- 1. 毎回の記入欄 ---
    merge(ws, "A5:H5", "1. お金を出し入れしたら、その場で1行記入(入金と出金は別の列に書く)",
          bold=True, border=False)
    heads = ["日付", "区分\n売預買他", "内容・取引先", "担当", "入金(+)", "出金(−)",
             "レシ\nート", "確認"]
    for col, h in zip("ABCDEFGH", heads):
        put(ws, f"{col}6", h, bold=True, fill=HEAD_FILL, align="center", size=9,
            wrap=True)
    ws.row_dimensions[6].height = 26
    start = 7
    end = start + LOG_ROWS - 1
    for i in range(LOG_ROWS):
        row = start + i
        s = EXAMPLE_LOG[i] if example and i < len(EXAMPLE_LOG) else None
        put(ws, f"A{row}", s[0] if s else None, fill=INPUT_FILL, align="center", size=9)
        put(ws, f"B{row}", s[1] if s else "売・預・買・他", fill=INPUT_FILL,
            align="center", size=7 if not s else 9,
            color="000000" if s else "808080")
        put(ws, f"C{row}", s[2] if s else None, fill=INPUT_FILL, size=9)
        put(ws, f"D{row}", s[3] if s else None, fill=INPUT_FILL, align="center", size=9)
        put(ws, f"E{row}", s[4] if s else None, fill=INPUT_FILL, align="right", fmt=YEN)
        put(ws, f"F{row}", s[5] if s else None, fill=INPUT_FILL, align="right", fmt=YEN)
        put(ws, f"G{row}", s[6] if s else None, fill=INPUT_FILL, align="center", size=9)
        put(ws, f"H{row}", None, align="center")
        ws.row_dimensions[row].height = 20
    tot = end + 1
    merge(ws, f"A{tot}:D{tot}", "今週の合計", bold=True, fill=HEAD_FILL, align="center")
    put(ws, f"E{tot}", f"=SUM(E{start}:E{end})", bold=True, align="right", fmt=YEN)
    put(ws, f"F{tot}", f"=SUM(F{start}:F{end})", bold=True, align="right", fmt=YEN)
    merge(ws, f"G{tot}:H{tot}", None)
    ws.row_dimensions[tot].height = 20

    # --- 2. 週末の金種表 ---
    r = tot + 2
    merge(ws, f"A{r}:H{r}", "2. 週1回、2人で金庫の現金を数える(金種ごとの枚数を記入)",
          bold=True, border=False)
    r += 1
    # 左ブロック A(金種) B(枚数) C(金額) / 右ブロック D(金種) E(枚数) F(金額)
    for col, h in zip("ABCDEF", ["金種", "枚数", "金額(円)", "金種", "枚数", "金額(円)"]):
        put(ws, f"{col}{r}", h, bold=True, fill=HEAD_FILL, align="center", size=9)
    left, right = DENOMS[:5], DENOMS[5:]
    d0 = r + 1
    for i in range(5):
        row = d0 + i
        pairs = [(left[i], "A", "B", "C")]
        if i < len(right):
            pairs.append((right[i], "D", "E", "F"))
        for denom, dc, nc, ac in pairs:
            label = f"{denom:,}円" + ("札" if denom >= 1000 else "玉")
            put(ws, f"{dc}{row}", label, align="center", size=9)
            put(ws, f"{nc}{row}", EXAMPLE_COUNTS[denom] if example else None,
                fill=INPUT_FILL, align="right", fmt='#,##0;-#,##0;""')
            put(ws, f"{ac}{row}", f"={denom}*{nc}{row}", align="right", fmt=YEN)
        ws.row_dimensions[row].height = 19
    d1 = d0 + 4
    counts = f"B{d0}:B{d1},E{d0}:E{d0 + len(right) - 1}"
    counted_sum = f"SUM(C{d0}:C{d1})+SUM(F{d0}:F{d0 + len(right) - 1})"

    # --- 3. 残高の確認 ---
    r = d1 + 2
    merge(ws, f"A{r}:H{r}", "3. 帳簿の残高と実際の金額を比べる", bold=True, border=False)
    r += 1
    b = r  # 表の先頭行
    lines = [
        ("① 先週からの繰越", f"={carry}", False, YEN),
        ("② 今週の入金合計", f"=E{tot}", False, YEN),
        ("③ 今週の出金合計", f"=F{tot}", False, YEN),
        ("④ 帳簿の残高(①+②−③)", f'=IF(COUNT(E{start}:F{end})=0,"",D{b}+D{b+1}-D{b+2})', False, YEN),
        ("⑤ 実際に数えた金額(2の合計)", f'=IF(COUNT({counts})=0,"",{counted_sum})', False, YEN),
        ("⑥ 差額(⑤−④)", f'=IF(OR(D{b+3}="",D{b+4}=""),"",D{b+4}-D{b+3})', False, YEN_DIFF),
        (f"⑦ 銀行へ入金(⑤が{BASE_AMOUNT:,}円を超えた分)", 61858 if example else None, True, YEN),
        (f"⑧ 補充(⑤が{BASE_AMOUNT:,}円に足りない分)", None, True, YEN),
        ("⑨ 来週への繰越(⑤−⑦+⑧)", f'=IF(D{b+4}="","",D{b+4}-D{b+6}+D{b+7})', False, YEN),
    ]
    for k, (label, val, is_input, fmt) in enumerate(lines):
        row = b + k
        merge(ws, f"A{row}:C{row}", label, bold=True, fill=HEAD_FILL, size=9)
        put(ws, f"D{row}", val, align="right", fmt=fmt, bold=True,
            fill=INPUT_FILL if is_input else None)
        ws.row_dimensions[row].height = 19
    # 右側に注意書きと押印欄
    merge(ws, f"E{b}:H{b+3}",
          "・⑥が0でなければ下の「差額の原因」を記入し、当日中に責任者へ報告\n"
          f"・⑨は必ず{BASE_AMOUNT:,}円になる。来週の用紙の「繰越」は印字済み\n"
          "・銀行へ入金したら、その控えをこの用紙に貼る",
          size=8, wrap=True, border=False, color="595959")
    for col, h in zip("EFG", ["数えた人", "立会い", "責任者"]):
        put(ws, f"{col}{b+5}", h, bold=True, fill=HEAD_FILL, align="center", size=9)
        merge(ws, f"{col}{b+6}:{col}{b+8}", None)

    # --- 差額の原因 ---
    r = b + len(lines) + 1
    put(ws, f"A{r}", "差額の原因", bold=True, fill=HEAD_FILL, align="center", size=9,
        wrap=True)
    merge(ws, f"B{r}:H{r}", None, fill=INPUT_FILL, size=9, wrap=True)
    ws.row_dimensions[r].height = 34
    last = r

    # 印刷設定
    ws.print_area = f"A1:H{last}"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins = PageMargins(left=0.45, right=0.45, top=0.5, bottom=0.5)
    ws.print_options.horizontalCentered = True
    ws.oddFooter.center.text = "黄色の欄を記入。書き間違いは二重線+確認者の印(消さない・塗りつぶさない)"
    ws.oddFooter.center.size = 8
    ws.sheet_view.showGridLines = False


def build_guide(ws):
    ws.column_dimensions["A"].width = 110
    lines = [
        ("現金出納帳 兼 金庫確認表の使い方", True),
        ("", False),
        ("毎回(お金を出し入れしたとき)", True),
        ("1. 購入で現金を出したら「出金」、売上金・預かり金を入れたら「入金」の列に、その場で1行書く。", False),
        ("   ▲を付けて1つの列に書く方法はやめる(付け忘れると、入金か出金か分からなくなるため)。", False),
        ("2. 区分に○を付ける。売=ケータリング・オードブルの売上金、預=預かり金、買=購入、他=それ以外。", False),
        ("3. 購入のレシートは用紙の裏にホチキスで留め、「レシート」欄に✓を付ける。", False),
        ("", False),
        ("週1回(決めた曜日)", True),
        ("4. 2人で金庫の現金を金種ごとに数え、「2. 金種表」に書く。", False),
        ("5. 「3. 残高の確認」を上から順に計算する。⑥差額が0でなければ原因を書き、当日中に責任者へ報告。", False),
        (f"6. {BASE_AMOUNT:,}円を超えた分は銀行へ入金、足りない分は補充して、金庫を毎週{BASE_AMOUNT:,}円に戻す。", False),
        ("7. 用紙は責任者が押印してファイルに綴じ、1年間保管する。翌週は新しい用紙を使う。", False),
        ("", False),
        ("ルール", True),
        ("・書き間違いは二重線を引き、確認者が印を押す。修正液・塗りつぶしは使わない。", False),
        ("・後からまとめて書かない。日付順に並ばない記入は、記入漏れのサインとして責任者が確認する。", False),
        ("・数える人は毎週交代する(同じ人に固定しない)。", False),
    ]
    for i, (text, bold) in enumerate(lines, start=1):
        c = ws.cell(row=i, column=1, value=text)
        c.font = f(14 if i == 1 else 11, bold)
        c.alignment = Alignment(wrap_text=True, vertical="center")
    ws.sheet_view.showGridLines = False


wb = Workbook()
guide = wb.active
guide.title = "使い方"
build_guide(guide)
build_sheet(wb.create_sheet("出納帳(印刷用)"))
build_sheet(wb.create_sheet("記入例"), example=True)
wb.active = 1
wb.save(OUT)
print("saved", OUT)
