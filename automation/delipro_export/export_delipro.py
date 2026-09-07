"""
export_delipro.py
デリPRO 自動ログイン → 売上CSVダウンロード → Excel反映

【重要】login() / open_sales_csv_page() / download_csv() は、
実際のデリPRO画面をこのスクリプトの作成時に確認できなかったため、
一般的なログインフォームを想定した仮実装のままです。
README.md 手順2（playwright codegen での操作記録）を必ず行い、
記録結果でこの3つの関数を実際のセレクタに置き換えてから使ってください。
"""

import argparse
import json
import logging
import smtplib
from datetime import datetime
from email.mime.text import MIMEText
from pathlib import Path

from playwright.sync_api import sync_playwright

from csv_to_excel import write_csv_to_sheet

BASE_DIR = Path(__file__).parent


def load_config(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(
            f"{path} が見つかりません。config.example.json をコピーして "
            "config.json を作成し、実際の値を入力してください。"
        )
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def setup_logging(log_dir: Path) -> Path:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{datetime.now():%Y%m%d_%H%M%S}.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(log_path, encoding="utf-8"),
            logging.StreamHandler(),
        ],
    )
    return log_path


def login(page, config: dict) -> None:
    """デリPROにログインする。

    TODO: README.md 手順2の playwright codegen 記録結果に置き換えること。
    以下は一般的なID/パスワード形式のログインフォームを想定した仮実装。
    """
    page.goto(config["login_url"])
    page.fill('input[name="cid"], input[name="contractor_id"]', config["contractor_id"])
    page.fill('input[name="staffid"], input[name="staff_id"]', config["staff_id"])
    page.fill('input[type="password"]', config["password"])
    page.click('button[type="submit"], input[type="submit"]')
    page.wait_for_load_state("networkidle")


def open_sales_csv_page(page, config: dict) -> None:
    """売上CSVがダウンロードできる画面へ移動する。

    TODO: codegen の記録結果をもとに実装すること。
    ログイン後、どのメニューをクリックしてCSVダウンロード画面にたどり着くかが
    未確認のため、ここは意図的に未実装（NotImplementedError）にしてある。
    """
    raise NotImplementedError(
        "open_sales_csv_page() は未実装です。"
        "README.md 手順2の記録結果をもとに実装してください。"
    )


def download_csv(page, config: dict, download_dir: Path) -> Path:
    """CSVダウンロードボタンを押し、保存先のファイルパスを返す。

    TODO: codegen の記録結果に置き換えること。
    """
    download_dir.mkdir(parents=True, exist_ok=True)
    with page.expect_download() as download_info:
        page.click("text=CSVダウンロード")  # 仮のセレクタ。要修正。
    download = download_info.value
    dest = download_dir / f"delipro_{datetime.now():%Y%m%d_%H%M%S}.csv"
    download.save_as(dest)
    logging.info("CSVを保存しました: %s", dest)
    return dest


def notify_failure(config: dict, message: str) -> None:
    notif = config.get("notification", {})
    if not notif.get("enabled"):
        logging.warning("通知は無効設定です。このエラーはメールされません: %s", message)
        return
    try:
        msg = MIMEText(message)
        msg["Subject"] = "[デリPRO自動取得] エラーが発生しました"
        msg["From"] = notif["mail_from"]
        msg["To"] = ", ".join(notif["mail_to"])
        with smtplib.SMTP(notif["smtp_host"], notif["smtp_port"]) as server:
            server.starttls()
            server.login(notif["smtp_user"], notif["smtp_password"])
            server.send_message(msg)
        logging.info("エラー通知メールを送信しました")
    except Exception:
        logging.exception("エラー通知メールの送信自体に失敗しました")


def write_status(base_dir: Path, ok: bool, detail: str) -> None:
    status_path = base_dir / "last_run_status.txt"
    status_path.write_text(
        f"{datetime.now():%Y-%m-%d %H:%M:%S}\t{'OK' if ok else 'NG'}\t{detail}\n",
        encoding="utf-8",
    )


def run(config: dict, headless: bool) -> None:
    download_dir = BASE_DIR / config.get("download_dir", "downloads")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page(accept_downloads=True)
        try:
            login(page, config)
            open_sales_csv_page(page, config)
            csv_path = download_csv(page, config, download_dir)
        finally:
            browser.close()

    n = write_csv_to_sheet(
        csv_path,
        Path(config["excel_path"]),
        config.get("sheet_name", "03_デリPRO_CSV"),
        config.get("csv_encoding", "cp932"),
    )
    logging.info("完了：%d 行を反映しました", n)


def main() -> None:
    parser = argparse.ArgumentParser(description="デリPRO 売上CSV自動取得")
    parser.add_argument("--config", type=Path, default=BASE_DIR / "config.json")
    parser.add_argument(
        "--headed", action="store_true", help="ブラウザ画面を表示して実行する（動作確認用）"
    )
    args = parser.parse_args()

    config = load_config(args.config)
    setup_logging(BASE_DIR / config.get("log_dir", "logs"))

    try:
        run(config, headless=not args.headed)
        write_status(BASE_DIR, ok=True, detail="正常終了")
    except Exception as e:
        logging.exception("処理中にエラーが発生しました")
        write_status(BASE_DIR, ok=False, detail=str(e))
        notify_failure(config, f"デリPRO自動取得でエラーが発生しました: {e}")
        raise


if __name__ == "__main__":
    main()
