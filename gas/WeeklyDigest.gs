/**
 * 毎日「今日から1週間分の予定+やることリスト」をメールで送る処理。
 *
 * セットアップ:
 * 1. Config.gs の CONFIG.DIGEST を確認する(送信先・時刻・カレンダー)
 * 2. Apps Scriptエディタで installDigestTrigger を1回だけ実行する(毎日自動送信のトリガーが作られる)
 * 3. 動作確認したいときは sendWeeklyDigest を手動実行する
 */

const WEEKDAYS_JA_ = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 毎日実行されるメイン処理。
 */
function sendWeeklyDigest() {
  const cfg = CONFIG.DIGEST;
  try {
    const tz = Session.getScriptTimeZone();
    const today = startOfDay_(new Date());
    const days = buildDays_(today, cfg.DAYS);

    cfg.CALENDARS.forEach(function (cal) {
      collectEvents_(cal, days, tz);
    });
    const lastDay = days[days.length - 1].date;
    const tasks = cfg.INCLUDE_TASKS ? collectTasks_(today, lastDay, tz) : { overdue: [], inRange: [], noDue: [] };
    addFollowupTasks_(days, tasks, today, lastDay, tz);

    const checks = {
      duplicates: findDuplicateProjects_(days),
      holidayConflicts: findHolidayConflicts_(days),
    };

    const subject = '【1週間予定】' + formatDay_(today, tz) + '〜' + formatDay_(lastDay, tz);
    const mail = renderDigest_(days, tasks, checks, tz);
    MailApp.sendEmail({ to: cfg.RECIPIENT, subject: subject, body: mail.text, htmlBody: mail.html });
  } catch (err) {
    Logger.log('sendWeeklyDigest failed: ' + err);
    MailApp.sendEmail(cfg.RECIPIENT, '【エラー】1週間予定メールの自動送信', String(err && err.stack ? err.stack : err));
  }
}

/**
 * 毎日 CONFIG.DIGEST.SEND_HOUR 時台に sendWeeklyDigest を実行するトリガーを作る。
 * 既存の同名トリガーは削除してから作り直すので、何度実行しても重複しない。
 */
function installDigestTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendWeeklyDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendWeeklyDigest')
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.DIGEST.SEND_HOUR)
    .inTimezone(Session.getScriptTimeZone())
    .create();
}

function buildDays_(today, count) {
  const days = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push({ date: d, items: [] });
  }
  return days;
}

/**
 * カレンダーの予定を日ごとに振り分ける。日をまたぐ終日予定(連休など)は各日に表示する。
 */
function collectEvents_(cal, days, tz) {
  const calendar = CalendarApp.getCalendarById(cal.ID);
  if (!calendar) {
    throw new Error('カレンダーが見つかりません: ' + cal.LABEL + ' (' + cal.ID + ')');
  }
  days.forEach(function (day) {
    const next = new Date(day.date);
    next.setDate(day.date.getDate() + 1);
    calendar.getEvents(day.date, next).forEach(function (ev) {
      // 前日から続く時間指定の予定は開始日にだけ載せる
      if (!ev.isAllDayEvent() && ev.getStartTime() < day.date) return;
      const title = ev.getTitle();
      if (cal.ONLY_DEFAULT_COLOR && ev.getColor()) return;
      if (
        (cal.EXCLUDE_TAGS || []).some(function (tag) {
          return title.indexOf(tag) !== -1;
        })
      ) {
        return;
      }
      const status = cal.TYPE === 'PROJECT' ? projectStatus_(title) : '';
      day.items.push({
        calendar: cal.LABEL,
        type: cal.TYPE,
        title: title,
        status: status,
        // 期日の読み取りに使うので、未確定案件だけ説明文を持っておく
        description: status === '未確定' ? stripHtml_(ev.getDescription() || '') : '',
        allDay: ev.isAllDayEvent(),
        start: ev.getStartTime(),
        end: ev.getEndTime(),
        time: ev.isAllDayEvent()
          ? '終日'
          : Utilities.formatDate(ev.getStartTime(), tz, 'HH:mm') + '-' + Utilities.formatDate(ev.getEndTime(), tz, 'HH:mm'),
      });
    });
  });
}

/**
 * 件名の先頭付近から案件ステータスを判定する。
 * 例: 「★確定ケ【直】…」「未確定オ【直】…」「キャンセル確定オ【直】…」「金額未達連絡なし未確定オ…」
 * 「確定/未確定/キャンセル」を含まない予定(打ち合わせ・返却・面接など)は「その他」。
 */
function projectStatus_(title) {
  const head = title.split('【')[0];
  if (head.indexOf('キャンセル') !== -1) return 'キャンセル';
  if (head.indexOf('未確定') !== -1) return '未確定';
  if (head.indexOf('確定') !== -1) return '確定';
  return 'その他';
}

/**
 * 未確定案件の件名・説明から「10/5午前中人数確定予定」のような期日を拾い、自動のやることとして追加する。
 * 期日が過ぎても案件が未確定のままなら「期限切れ」に入る。
 */
function addFollowupTasks_(days, tasks, today, lastDay, tz) {
  const pattern = CONFIG.DIGEST.FOLLOWUP_PATTERN;
  if (!pattern) return;
  const todayKey = Utilities.formatDate(today, tz, 'yyyy-MM-dd');
  const lastKey = Utilities.formatDate(lastDay, tz, 'yyyy-MM-dd');
  const seen = {};

  days.forEach(function (day) {
    day.items.forEach(function (it) {
      if (it.status !== '未確定') return;
      const m = pattern.exec(it.title) || pattern.exec(it.description);
      if (!m) return;
      const dueKey = followupDateKey_(Number(m[1]), Number(m[2]), today, tz);
      if (!dueKey || seen[it.title + dueKey]) return;
      seen[it.title + dueKey] = true;

      const task = { list: '自動', auto: true, dueKey: dueKey, title: projectName_(it.title) + ' の' + m[0] + 'を確認' };
      if (dueKey < todayKey) {
        tasks.overdue.push(task);
      } else if (dueKey <= lastKey) {
        tasks.inRange.push(task);
      }
    });
  });
  tasks.overdue.sort(function (a, b) {
    return a.dueKey < b.dueKey ? -1 : a.dueKey > b.dueKey ? 1 : 0;
  });
}

/**
 * 「月/日」に年を補う。半年以上前の日付になる場合は翌年とみなす(12月に1月の予定を書いた場合など)。
 */
function followupDateKey_(month, date, today, tz) {
  if (month < 1 || month > 12 || date < 1 || date > 31) return '';
  let d = new Date(today.getFullYear(), month - 1, date);
  if (today - d > 180 * 24 * 60 * 60 * 1000) d = new Date(today.getFullYear() + 1, month - 1, date);
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

/**
 * 同じ会社名の案件(確定・未確定)が期間内の別の日にもあれば、入力ミスの可能性として返す。
 */
function findDuplicateProjects_(days) {
  const groups = {};
  days.forEach(function (day) {
    day.items.forEach(function (it) {
      if (it.status !== '確定' && it.status !== '未確定') return;
      const key = normalizeName_(projectName_(it.title));
      if (!key) return;
      (groups[key] = groups[key] || []).push({ day: day, item: it });
    });
  });
  return Object.keys(groups)
    .map(function (key) {
      return groups[key];
    })
    .filter(function (list) {
      const dates = {};
      list.forEach(function (x) {
        dates[x.day.date.getTime()] = true;
      });
      return Object.keys(dates).length >= 2;
    });
}

/**
 * 個人カレンダーで休日(公休など)になっている日に、時間指定の予定が入っていれば返す。
 */
function findHolidayConflicts_(days) {
  const keywords = CONFIG.DIGEST.HOLIDAY_KEYWORDS || [];
  const conflicts = [];
  days.forEach(function (day) {
    const holiday = day.items.filter(function (it) {
      return (
        it.type === 'PERSONAL' &&
        it.allDay &&
        keywords.some(function (k) {
          return it.title.indexOf(k) !== -1;
        })
      );
    })[0];
    if (!holiday) return;
    day.holiday = holiday.title;
    day.items.forEach(function (it) {
      if (it.type === 'PERSONAL' && !it.allDay) conflicts.push({ day: day, holiday: holiday.title, item: it });
    });
  });
  return conflicts;
}

/**
 * 件名から会社名・お客様名の部分を取り出す。例: 「★確定ケ【直】株式会社オリバー ※請求書」→「株式会社オリバー」
 */
function projectName_(title) {
  const afterTag = title.lastIndexOf('】') !== -1 ? title.substring(title.lastIndexOf('】') + 1) : title;
  return afterTag.split('※')[0].trim();
}

function normalizeName_(name) {
  return name.replace(/株式会社|㈱|\(株\)|（株）|様|[\s　]/g, '');
}

function stripHtml_(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * Google ToDoリストの未完了タスクを、期限切れ・期間内・期限なしに分ける。
 */
function collectTasks_(today, lastDay, tz) {
  const result = { overdue: [], inRange: [], noDue: [] };
  const todayKey = Utilities.formatDate(today, tz, 'yyyy-MM-dd');
  const lastKey = Utilities.formatDate(lastDay, tz, 'yyyy-MM-dd');
  const staleMs = CONFIG.DIGEST.STALE_TASK_DAYS * 24 * 60 * 60 * 1000;

  const lists = Tasks.Tasklists.list({ maxResults: 100 }).items || [];
  lists.forEach(function (list) {
    let pageToken;
    do {
      const res = Tasks.Tasks.list(list.id, {
        showCompleted: false,
        showHidden: false,
        maxResults: 100,
        pageToken: pageToken,
      });
      (res.items || []).forEach(function (t) {
        if (!t.title) return;
        const task = { list: list.title, title: t.title, notes: t.notes || '' };
        if (!t.due) {
          task.stale = new Date() - new Date(t.updated) > staleMs;
          result.noDue.push(task);
          return;
        }
        // Tasks APIの期限は日付のみ(UTC 0時)で返るので、日付部分だけで比較する
        task.dueKey = t.due.substring(0, 10);
        if (task.dueKey < todayKey) {
          result.overdue.push(task);
        } else if (task.dueKey <= lastKey) {
          result.inRange.push(task);
        }
      });
      pageToken = res.nextPageToken;
    } while (pageToken);
  });

  const byDue = function (a, b) {
    return a.dueKey < b.dueKey ? -1 : a.dueKey > b.dueKey ? 1 : 0;
  };
  result.overdue.sort(byDue);
  result.inRange.sort(byDue);
  return result;
}

/**
 * メール本文(HTMLとテキスト)を作る。
 * 構成: 期限切れToDo → 公休日の予定 → 重複の疑い → 未確定案件(要確認) → 日別件数 → 日別の予定とToDo → 期限なしToDo
 */
function renderDigest_(days, tasks, checks, tz) {
  const excludeCancelled = CONFIG.DIGEST.EXCLUDE_CANCELLED;
  const html = [];
  const text = [];
  let cancelledCount = 0;

  const tasksByDay = {};
  tasks.inRange.forEach(function (t) {
    (tasksByDay[t.dueKey] = tasksByDay[t.dueKey] || []).push(t);
  });

  // 1. 期限切れのToDo
  if (tasks.overdue.length) {
    html.push('<h3 style="color:#c62828">期限切れのやること(' + tasks.overdue.length + '件)</h3><ul>');
    text.push('■ 期限切れのやること(' + tasks.overdue.length + '件)');
    tasks.overdue.forEach(function (t) {
      const due = Number(t.dueKey.substring(5, 7)) + '/' + Number(t.dueKey.substring(8, 10));
      html.push('<li>' + autoMark_(t, true) + esc_(t.title) + ' <span style="color:#888">(期限 ' + due + ')</span></li>');
      text.push('・' + autoMark_(t, false) + t.title + '(期限 ' + due + ')');
    });
    html.push('</ul>');
    text.push('');
  }

  // 公休日に入っている予定
  if (checks.holidayConflicts.length) {
    html.push('<h3 style="color:#c62828">公休日に予定が入っています(' + checks.holidayConflicts.length + '件)</h3><ul>');
    text.push('■ 公休日に予定が入っています(' + checks.holidayConflicts.length + '件)');
    checks.holidayConflicts.forEach(function (c) {
      const line = formatDay_(c.day.date, tz) + '【' + c.holiday + '】 ' + c.item.time + ' ' + c.item.title;
      html.push('<li>' + esc_(line) + '</li>');
      text.push('・' + line);
    });
    html.push('</ul>');
    text.push('');
  }

  // 同じ会社の案件が複数日にある(入力ミスの可能性)
  if (checks.duplicates.length) {
    html.push('<h3 style="color:#ef6c00">重複の疑い(' + checks.duplicates.length + '社)</h3>');
    html.push('<p style="color:#888;margin:0">同じ会社の案件が別の日にもあります。連日の案件なら問題ありません。</p><ul>');
    text.push('■ 重複の疑い(' + checks.duplicates.length + '社) ※連日の案件なら問題ありません');
    checks.duplicates.forEach(function (list) {
      const line =
        projectName_(list[0].item.title) +
        ': ' +
        list
          .map(function (x) {
            return formatDay_(x.day.date, tz) + ' ' + x.item.time.split('-')[0] + ' ' + x.item.status;
          })
          .join(' / ');
      html.push('<li>' + esc_(line) + '</li>');
      text.push('・' + line);
    });
    html.push('</ul>');
    text.push('');
  }

  // 2. 未確定案件(要確認)
  const pending = [];
  days.forEach(function (day) {
    day.items.forEach(function (it) {
      if (it.status === '未確定') pending.push({ day: day, item: it });
    });
  });
  pending.sort(function (a, b) {
    return a.item.start - b.item.start;
  });
  if (pending.length) {
    html.push('<h3 style="color:#ef6c00">未確定の案件・要確認(' + pending.length + '件)</h3><ul>');
    text.push('■ 未確定の案件・要確認(' + pending.length + '件)');
    pending.forEach(function (p) {
      const line = formatDay_(p.day.date, tz) + ' ' + p.item.time + ' ' + p.item.title;
      html.push('<li>' + esc_(line) + '</li>');
      text.push('・' + line);
    });
    html.push('</ul>');
    text.push('');
  }

  // 3. 日別件数
  html.push('<h3>日別の案件数</h3><table style="border-collapse:collapse" cellpadding="4">');
  html.push('<tr style="background:#eee"><th>日付</th><th>確定</th><th>未確定</th><th>ToDo</th></tr>');
  text.push('■ 日別の案件数(確定/未確定/ToDo)');
  days.forEach(function (day) {
    const key = Utilities.formatDate(day.date, tz, 'yyyy-MM-dd');
    const confirmed = countStatus_(day.items, '確定');
    const unconfirmed = countStatus_(day.items, '未確定');
    const todo = (tasksByDay[key] || []).length;
    html.push(
      '<tr><td>' + formatDay_(day.date, tz) + '</td><td align="right">' + confirmed + '</td><td align="right">' +
        unconfirmed + '</td><td align="right">' + todo + '</td></tr>'
    );
    text.push(formatDay_(day.date, tz) + '  ' + confirmed + ' / ' + unconfirmed + ' / ' + todo);
  });
  html.push('</table>');
  text.push('');

  // 4. 日別の予定とToDo
  html.push('<h3>日別の予定</h3>');
  text.push('■ 日別の予定');
  days.forEach(function (day) {
    const key = Utilities.formatDate(day.date, tz, 'yyyy-MM-dd');
    const items = day.items
      .filter(function (it) {
        if (excludeCancelled && it.status === 'キャンセル') {
          cancelledCount++;
          return false;
        }
        return true;
      })
      .sort(function (a, b) {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return a.start - b.start;
      });
    const dayTasks = tasksByDay[key] || [];

    const holidayMark = day.holiday ? '【' + day.holiday + '】' : '';
    html.push(
      '<h4 style="margin-bottom:4px;border-bottom:1px solid #ccc">' + formatDay_(day.date, tz) +
        (holidayMark ? ' <span style="color:#c62828">' + esc_(holidayMark) + '</span>' : '') + '</h4><ul>'
    );
    text.push('');
    text.push('◆ ' + formatDay_(day.date, tz) + ' ' + holidayMark);
    if (!items.length && !dayTasks.length) {
      html.push('<li style="color:#888">予定なし</li>');
      text.push('  予定なし');
    }
    dayTasks.forEach(function (t) {
      html.push('<li>☐ <b>ToDo</b> ' + autoMark_(t, true) + esc_(t.title) + '</li>');
      text.push('  ☐ ToDo ' + autoMark_(t, false) + t.title);
    });
    items.forEach(function (it) {
      const color = it.status === '未確定' ? '#ef6c00' : it.status === 'キャンセル' ? '#999' : '#000';
      html.push(
        '<li style="color:' + color + '">' + esc_(it.time) + ' <span style="color:#888">[' + esc_(it.calendar) + ']</span> ' +
          esc_(it.title) + '</li>'
      );
      text.push('  ' + it.time + ' [' + it.calendar + '] ' + it.title);
    });
    html.push('</ul>');
  });
  text.push('');

  // 5. 期限なしのToDo
  if (tasks.noDue.length) {
    html.push('<h3>期限なしのやること(' + tasks.noDue.length + '件)</h3><ul>');
    text.push('■ 期限なしのやること(' + tasks.noDue.length + '件)');
    tasks.noDue.forEach(function (t) {
      const mark = t.stale ? ' <span style="color:#c62828">停滞</span>' : '';
      html.push('<li>' + esc_(t.title) + mark + '</li>');
      text.push('・' + t.title + (t.stale ? '(停滞)' : ''));
    });
    html.push('</ul>');
    text.push('');
  }

  if (cancelledCount) {
    html.push('<p style="color:#888">キャンセル案件 ' + cancelledCount + '件は非表示にしています。</p>');
    text.push('キャンセル案件 ' + cancelledCount + '件は非表示にしています。');
  }

  return { html: '<div style="font-family:sans-serif;font-size:14px">' + html.join('') + '</div>', text: text.join('\n') };
}

function autoMark_(task, html) {
  if (!task.auto) return '';
  return html ? '<span style="color:#1565c0">[自動]</span> ' : '[自動]';
}

function countStatus_(items, status) {
  return items.filter(function (it) {
    return it.status === status;
  }).length;
}

function startOfDay_(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function formatDay_(d, tz) {
  return Utilities.formatDate(d, tz, 'M/d') + '(' + WEEKDAYS_JA_[Number(Utilities.formatDate(d, tz, 'u')) % 7] + ')';
}

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
