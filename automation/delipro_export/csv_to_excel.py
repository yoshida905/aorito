"""
デリPROからダウンロードしたCSVを読み込み、
「大阪GB｜人時限界利益」フォーマットの 03_デリPRO_CSV シートへ書き込む。

このファイル単体はネットワークに接続しないので、
サンプルCSVとサンプルExcelがあればこのセッション内でも動作確認できる。
"""

import csv
import logging
from pathlib import Path

import openpyxl

logger = logging.getLogger(__name__)

HEADER_ROW = 3
DATA_START_ROW = 4


def read_csv_rows(csv_path: Path, encoding: str) -> tuple[list[str], list[list[str]]]:
    with open(csv_path, encoding=encoding, newline="") as f:
        reader = csv.reader(f)
        rows = list(reader)
    if not rows:
        raise ValueError(f"{csv_path} が空です")
    header, data = rows[0], rows[1:]
    return header, data


def write_csv_to_sheet(
    csv_path: Path,
    excel_path: Path,
    sheet_name: str,
    csv_encoding: str,
) -> int:
    """CSVを読み込み、Excelの指定シートに書き込む。書き込んだ行数を返す。"""

    csv_header, csv_data = read_csv_rows(csv_path, csv_encoding)

    wb = openpyxl.load_workbook(excel_path)
    if sheet_name not in wb.sheetnames:
        raise ValueError(f"シート '{sheet_name}' が {excel_path} に見つかりません")
    ws = wb[sheet_name]

    sheet_header = [
        ws.cell(HEADER_ROW, c).value
        for c in range(1, ws.max_column + 1)
        if ws.cell(HEADER_ROW, c).value
    ]

    # CSV側の列名 → シート側の列位置（1始まり）
    col_map: dict[int, int] = {}
    missing_in_csv = []
    for sheet_col_idx, sheet_col_name in enumerate(sheet_header, start=1):
        if sheet_col_name in csv_header:
            col_map[sheet_col_idx] = csv_header.index(sheet_col_name)
        else:
            missing_in_csv.append(sheet_col_name)

    unknown_in_csv = [h for h in csv_header if h not in sheet_header]

    if missing_in_csv:
        logger.warning(
            "CSVに存在しない列（シート側にあるがCSVにない）: %s", missing_in_csv
        )
    if unknown_in_csv:
        logger.warning(
            "シートに存在しない列（CSVにあるがシート側にない、無視される）: %s",
            unknown_in_csv,
        )

    # 既存データ行をクリア（HEADER_ROWは残す）
    existing_max_row = ws.max_row
    if existing_max_row >= DATA_START_ROW:
        for r in range(DATA_START_ROW, existing_max_row + 1):
            for c in range(1, len(sheet_header) + 1):
                ws.cell(r, c).value = None

    # 新しいデータを書き込む
    for i, row in enumerate(csv_data):
        target_row = DATA_START_ROW + i
        for sheet_col_idx in col_map:
            csv_col_idx = col_map[sheet_col_idx]
            value = row[csv_col_idx] if csv_col_idx < len(row) else None
            ws.cell(target_row, sheet_col_idx).value = value

    wb.save(excel_path)
    logger.info("%d 行を %s!%s に書き込みました", len(csv_data), sheet_name, excel_path)
    return len(csv_data)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="デリPRO CSV を Excel に書き込む（単体テスト用）")
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("excel_path", type=Path)
    parser.add_argument("--sheet-name", default="03_デリPRO_CSV")
    parser.add_argument("--encoding", default="cp932")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    n = write_csv_to_sheet(args.csv_path, args.excel_path, args.sheet_name, args.encoding)
    print(f"{n} 行を書き込みました")
