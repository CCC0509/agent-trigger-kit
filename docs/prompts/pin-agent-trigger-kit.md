# Runbook prompt: pin Agent Trigger Kit (consumer repo)

**Version:** v7.1-interactive-local-first
**Purpose:** A paste-ready operator prompt that wires a _consumer_ repository onto
the Agent Trigger Kit pinned auto-update flow, then drives it all the way through
PR merge, local sync, and Renovate enablement guidance.

This prompt is for running **inside a consumer repo** (e.g. a project that depends on
the kit), not inside the Agent Trigger Kit repo itself. It includes a hard gate that
stops if it detects it is running in the kit repo.

## How to use

1. Copy the fenced `Prompt (v7.1-interactive-local-first)` block below into a fresh agent session
   opened in the consumer repo.
2. **Fill the top two lines with real values** before sending, e.g.:

   ```text
   KIT_REPO = CCC0509/agent-trigger-kit
   PIN_VERSION = v0.2.4
   ```

   Do **not** leave the `<owner>/...` placeholders — the prompt's first hard check
   rejects unfilled placeholders, and an unfilled value risks wrong substitution.

3. The agent will pause at two human gates:
   - **[Pause A]** after CI is green — it lists a diff sanity check and waits for your
     explicit "可以 merge" before merging.
   - **[Pause B]** Renovate UI — it prints the Mend UI steps and waits for you to reply
     "已 enabled" / "未 enabled". Mend GitHub App installation cannot be confirmed by CLI,
     so this last mile is always human.

## Design notes (why it is shaped this way)

- **Repo-agnostic:** swap `KIT_REPO` / `PIN_VERSION` only; everything else
  (consumer repo slug, `KIT_SPEC`, Renovate `depName`, default branch) is auto-derived.
- **Single derivation formula:** define `ROOT="${ROOT:-.}"`,
  `PIN_FILE="$ROOT/.agent-trigger-kit/pin"`,
  `KIT_REF="$(tr -d '[:space:]' < "$PIN_FILE")"`, then
  `KIT_SPEC="github:${KIT_REPO}#$KIT_REF"` — this is the only way `KIT_SPEC`
  is built; no hardcoded version, no inline `repo#version`.
- **`validate` and `pin-check` never share an exit code** — separate CI steps and logs.
- **Re-entrant:** idempotent rules for existing branch / PR / merged / enabled states,
  so an interrupted run resumes safely instead of opening a second PR.
- **Safe merge & sync:** human gate before merge; `git reset --hard` only when the local
  default branch is tree-identical to origin after a squash merge.
- **Honest Renovate handoff:** the agent never claims it confirmed the Mend UI.

## Prompt (v7.1-interactive-local-first)

```text
═══════════════════════════════════════════════
填這裡（換 repo 時只改這兩行，且必須填成真值）
═══════════════════════════════════════════════
KIT_REPO   = <owner>/<agent-trigger-kit repo>   例如 CCC0509/agent-trigger-kit
PIN_VERSION = <要 pin 的 tag>                     例如 v0.2.4
───────────────────────────────────────────────
貼給 agent 前，上面兩行必須換成真值（例如 KIT_REPO = CCC0509/agent-trigger-kit、
PIN_VERSION = v0.2.4）。不得保留 <owner>/... 佔位字串，否則前置檢查會擋下或錯誤代入。
其餘一切（consumer repo 名稱、KIT_SPEC、Renovate depName、Mend 要選的 repo、預設分支）
都由下面的規則自動偵測或推導。KIT_REPO 的落地規則見下節。
═══════════════════════════════════════════════


請幫「當前這個 repo（consumer repo）」接上 Agent Trigger Kit pinned auto-update flow，
一路走到 PR merge、本地同步、Renovate 啟用引導完成。模型用 Sonnet 4.6 即可。

本流程有兩個「人工暫停點」，到了必須停下等我回覆，不得自行繼續：
  [暫停點 A] CI 綠後的 merge：列出 diff sanity 結果後停下，等我明確說「可以 merge」。
  [暫停點 B] Renovate UI：輸出 Mend UI 操作步驟後停下，等我回「已 enabled」或「未 enabled」。
但若 Resume 偵測到對應狀態已完成（見 Resume 段），則該暫停點視為已完成、直接略過。

═══════════════════════════════════════════════
KIT_REPO 落地規則（避免公式失效）
═══════════════════════════════════════════════
- KIT_REPO 會在多個 surface 各出現「一份常數」，這是正常且必要的，合法落地點：
    (a) CI workflow 的 env：KIT_REPO: "<owner>/<repo>"
    (b) AGENTS.md snippet：KIT_REPO="<owner>/<repo>"
    (c) renovate.json 的 depNameTemplate（實際字串）
    (d) PR body / final report（說明用）
  「單一常數」的意思是：每個 surface 用一份常數，而「不要在 KIT_SPEC 裡重複硬拼 repo+version」。
- 凡是要組 KIT_SPEC，一律且只用：
    ROOT="${ROOT:-.}"
    PIN_FILE="$ROOT/.agent-trigger-kit/pin"
    KIT_REF="$(tr -d '[:space:]' < "$PIN_FILE")"
    KIT_SPEC="github:${KIT_REPO}#$KIT_REF"
  不得在 KIT_SPEC 裡直接拼 github:owner/repo#version，也不得硬編版本號。
- AGENTS.md 若寫出 KIT_SPEC 公式，同一段內必須先定義 KIT_REPO，否則公式無意義。

═══════════════════════════════════════════════
自動偵測（開跑前先做，並回報）
═══════════════════════════════════════════════
CONSUMER_REPO  = gh repo view --json nameWithOwner -q .nameWithOwner
DEFAULT_BRANCH = git symbolic-ref --quiet --short refs/remotes/origin/HEAD | sed 's#^origin/##'
                 # fallback：gh repo view --json defaultBranchRef -q .defaultBranchRef.name

═══════════════════════════════════════════════
開跑前硬性前置檢查（任一不符就「停下並回報」，不要繼續）
═══════════════════════════════════════════════
- KIT_REPO / PIN_VERSION 已填成真值（非 <...> 佔位）。
- 能取得 CONSUMER_REPO，且 CONSUMER_REPO != KIT_REPO。
  若相同 → 誤在 Agent Trigger Kit 本身執行，立刻停止並回報「環境錯誤：當前是 kit repo 本身」。
- gh 可用（gh auth status 通過）。
- 若 repo 有 AGENTS.md / playbook，先讀並遵守，尤其找出 escalation 段落（沙箱失敗時用）。

並先回報以下現況（只讀，不改）：
- git status --short --branch
- repo root / CONSUMER_REPO / DEFAULT_BRANCH
- 是否已有 .agent-trigger-kit/ 、AGENTS.md
- 是否已有 Renovate config：renovate.json / .github/renovate.json / .renovaterc* / package.json 內 renovate 欄位
- 是否已有 GitHub Actions workflow（.github/workflows/*）
- 是否已有 feature branch chore/pin-agent-trigger-kit（local 或 remote）
- 是否已有對應 PR：以 head branch chore/pin-agent-trigger-kit 優先查
  （gh pr list --head chore/pin-agent-trigger-kit --state all）；
  若 branch 名走了 fallback（見 PR 流程），改查該 fallback branch。

═══════════════════════════════════════════════
Resume / Idempotency（像 state machine，可重入）
═══════════════════════════════════════════════
- 若 pin / AGENTS / CI / Renovate 已存在且符合要求 → 不要重寫，只驗證。
- 若 feature branch 已存在 → 沿用，不重建。
- 若 PR 已存在且未 merge → 沿用，不開第二個。
- 若 PR 已 merge → 視為 [暫停點 A] 已由先前人工同意完成，跳過實作/PR，直接進「Merge 後」。
- 若我在本輪 prompt 已明確告知 Mend repo enabled → 視為 [暫停點 B] 已完成；否則停下引導。
- 每步開始前先檢查當前狀態，已完成的只驗證、不重做。

═══════════════════════════════════════════════
原則
═══════════════════════════════════════════════
- 保守修改，不覆蓋既有設定；既有 config 一律「合併」而非取代。
- 不 push 預設分支（DEFAULT_BRANCH）。
- 可以：建/沿用 feature branch、push、開/沿用 PR、等 CI、（經我同意後）squash merge、刪 branch、同步預設分支。
- 不要 deploy，不需要 production smoke。
- 不要建立或 commit .claude/settings.local.json。

═══════════════════════════════════════════════
Closeout invocation policy（AGENTS / Cursor / final report 都要一致）
═══════════════════════════════════════════════
- A closeout attempt counts as having run only when output includes:
    Session closeout check
- If JSON output is used, require both:
    "kind": "session_check"
    "mode": "closeout"
- When a closeout report appears, trust that report and its printed exit code.
  Do not run a later tier to mask a non-zero closeout result.
- Use tiers in this order:
    1. Consumer installed package: `$ROOT/node_modules/.bin/agent-trigger-kit`
    2. Verified PATH/global package: `command -v agent-trigger-kit` plus a semver pin version gate
    3. Pinned external package: `npx --yes "$KIT_SPEC" session-check --closeout --root "$ROOT"`
- The PATH/global tier is an opportunistic, low-integrity optimization.
  `agent-trigger-kit --version` reports the PATH binary's package version.
  The PATH tier invokes `$PATH_ATK --version` after `command -v agent-trigger-kit`
  resolves the binary. Package-version equality only proves the binary declares
  the same package version as a semver pin; it is not proof of pinned-ref content
  equivalence.
- Non-semver pins skip the PATH tier with `status=path_non_semver_pin`.
  Version mismatches use `status=path_version_mismatch` and fall through to
  pinned external `npx`.
- For normal consumer repos, do not use `npx --no-install agent-trigger-kit ...` as
  the installed-package tier; local misses can enter npm registry resolution. Use
  this first-report-wins self-chaining ladder:
    ROOT="${ROOT:-.}"
    LOCAL_ATK="$ROOT/node_modules/.bin/agent-trigger-kit"
    PIN_FILE="$ROOT/.agent-trigger-kit/pin"
    KIT_REPO="<owner>/<repo>"
    CLOSEOUT_REPORT_SEEN=0
    CLOSEOUT_EXIT=1

    capture_command_output() {
      CAPTURE_ERREXIT=0
      case $- in
        *e*)
          CAPTURE_ERREXIT=1
          set +e
          ;;
      esac

      CAPTURE_OUTPUT="$("$@" 2>&1)"
      CAPTURE_STATUS="$?"

      if [ "$CAPTURE_ERREXIT" -eq 1 ]; then
        set -e
      fi
      return 0
    }

    run_closeout_tier() {
      if [ "$CLOSEOUT_REPORT_SEEN" -eq 1 ]; then
        return 0
      fi

      capture_command_output "$@"
      CLOSEOUT_OUTPUT="$CAPTURE_OUTPUT"
      CLOSEOUT_EXIT="$CAPTURE_STATUS"
      printf '%s\n' "$CLOSEOUT_OUTPUT"
      if printf '%s\n' "$CLOSEOUT_OUTPUT" | grep -q 'Session closeout check'; then
        CLOSEOUT_REPORT_SEEN=1
      fi
      return 0
    }

    realpath_or_same() {
      if command -v realpath >/dev/null 2>&1; then
        realpath "$1" 2>/dev/null || printf '%s' "$1"
      else
        printf '%s' "$1"
      fi
    }

    if [ -x "$LOCAL_ATK" ]; then
      run_closeout_tier "$LOCAL_ATK" session-check --closeout --root "$ROOT"
    else
      echo "agent-trigger-kit local binary missing; status=not_installed"
    fi

    if [ "$CLOSEOUT_REPORT_SEEN" -eq 0 ]; then
      PATH_ATK="$(command -v agent-trigger-kit 2>/dev/null || true)"
      LOCAL_ATK_REAL=""
      if [ -x "$LOCAL_ATK" ]; then
        LOCAL_ATK_REAL="$(realpath_or_same "$LOCAL_ATK")"
      fi

      if [ -z "$PATH_ATK" ]; then
        echo "agent-trigger-kit PATH binary missing; status=path_not_found"
      else
        PATH_ATK_REAL="$(realpath_or_same "$PATH_ATK")"
        if [ -n "$LOCAL_ATK_REAL" ] && [ "$PATH_ATK_REAL" = "$LOCAL_ATK_REAL" ]; then
          echo "agent-trigger-kit PATH binary already tried as local package; status=path_duplicate_local"
        elif [ ! -f "$PIN_FILE" ]; then
          echo "agent-trigger-kit pin missing at $PIN_FILE; status=skipped_missing_pin"
        else
          PIN_REF="$(tr -d '[:space:]' < "$PIN_FILE")"
          PIN_VERSION="$(printf '%s' "$PIN_REF" | sed 's/^[vV]//')"
          if ! printf '%s' "$PIN_REF" | grep -Eq '^[vV]?[0-9]+\.[0-9]+\.[0-9]+$'; then
            echo "agent-trigger-kit PATH fallback skipped; status=path_non_semver_pin"
          else
            capture_command_output "$PATH_ATK" --version
            PATH_VERSION_RAW="$CAPTURE_OUTPUT"
            PATH_VERSION_STATUS="$CAPTURE_STATUS"
            PATH_VERSION="$(printf '%s' "$PATH_VERSION_RAW" | tr -d '[:space:]')"
            if [ "$PATH_VERSION_STATUS" -ne 0 ] || [ -z "$PATH_VERSION" ]; then
              echo "agent-trigger-kit PATH version unknown; status=path_version_unknown"
            elif [ "$PATH_VERSION" = "$PIN_VERSION" ]; then
              run_closeout_tier "$PATH_ATK" session-check --closeout --root "$ROOT"
            else
              echo "agent-trigger-kit PATH version mismatch; status=path_version_mismatch pin=$PIN_VERSION path=${PATH_VERSION:-unknown}"
            fi
          fi
        fi
      fi
    fi

    if [ "$CLOSEOUT_REPORT_SEEN" -eq 0 ]; then
      if [ ! -f "$PIN_FILE" ]; then
        echo "agent-trigger-kit pin missing at $PIN_FILE; status=skipped_missing_pin"
      else
        KIT_REF="$(tr -d '[:space:]' < "$PIN_FILE")"
        KIT_SPEC="github:${KIT_REPO}#$KIT_REF"
        run_closeout_tier npx --yes "$KIT_SPEC" session-check --closeout --root "$ROOT"
      fi
    fi

    if [ "$CLOSEOUT_REPORT_SEEN" -eq 1 ]; then
      exit "$CLOSEOUT_EXIT"
    fi

    exit 1
- The ladder preserves the first-report-wins rule mechanically. If no closeout
  report appears after all tiers, the no-report path exits 1. It temporarily
  disables and restores `errexit` around output captures, so nonzero closeout
  reports still print and set the first-report marker under `set -e`.
- If no closeout report appears:
    * local package missing → note not_installed, then try PATH/global and pinned external
    * missing pin → report skipped_missing_pin with the expected pin path
    * PATH binary missing, PATH duplicate-local, non-semver pin, unknown PATH
      version, or PATH version mismatch → treat the PATH tier as a skipped
      optimization and continue to pinned external npx
    * explicit sandbox / approval / host policy denial before any report → blocked_by_policy
    * network / npm cache / package resolution / unknown failure → invocation_error
- When the denial signal is unclear, ambiguous no-report failures default to invocation_error.
  This conservative fallback avoids hiding real command, npm, cache, network, or package failures.

═══════════════════════════════════════════════
實作
═══════════════════════════════════════════════
1. 建立 .agent-trigger-kit/pin：內容為 PIN_VERSION 加單一結尾 newline。
   驗證：cat 後用 tr -d '[:space:]' 去空白，結果必須等於 PIN_VERSION；
   不得有第二行、註解或其他內容。

2. 更新或建立 AGENTS.md，加入 Agent Trigger Kit checks 段落。
   依「KIT_REPO 落地規則」：段內先定義 KIT_REPO，再用 KIT_SPEC 公式 derive，不硬編版本號。
   AGENTS.md snippet 必須同時包含：
   - KIT_REPO 常數、pin 檔、local binary、PATH binary，以及 interactive local-first helper：
       ROOT="${ROOT:-.}"
       KIT_REPO="<owner>/<repo>"
       LOCAL_ATK="$ROOT/node_modules/.bin/agent-trigger-kit"
       PIN_FILE="$ROOT/.agent-trigger-kit/pin"
       PIN_REF="$(tr -d '[:space:]' < "$PIN_FILE" 2>/dev/null || true)"
       KIT_SPEC="github:${KIT_REPO}#$PIN_REF"
       PATH_ATK="$(command -v agent-trigger-kit 2>/dev/null || true)"

       atk_run() {
         if [ -x "$LOCAL_ATK" ]; then "$LOCAL_ATK" "$@"; return $?; fi
         if ! printf '%s' "$PIN_REF" | grep -Eq '^[vV]?[0-9]+\.[0-9]+\.[0-9]+$'; then return 126; fi
         PIN_VERSION="$(printf '%s' "$PIN_REF" | sed 's/^[vV]//')"
         if [ -n "$PATH_ATK" ] && [ "$("$PATH_ATK" --version 2>/dev/null | tr -d '[:space:]')" = "$PIN_VERSION" ]; then
           "$PATH_ATK" "$@"; return $?
         fi
         return 127
       }
   - session-start / pin-check 是 advisory，不跑 pinned external npx：
       run_advisory() {
         label="$1"; shift
         atk_run "$@"; rc="$?"
         case "$rc" in
           0) ;;
           126) echo "agent-trigger-kit $label not run; status=path_non_semver_pin" ;;
           127) echo "agent-trigger-kit $label not run; status=interactive_skipped_local_first" ;;
           *) echo "agent-trigger-kit $label failed; exit=$rc" ;;
         esac
       }
       run_advisory session-check session-check --root "$ROOT"
       run_advisory pin-check pin-check --no-outcome --root "$ROOT"
   - trigger surface 變更後跑 validate，且必須用 exit code 分派，不能用 `atk_run validate || echo ...`：
       run_validate() {
         atk_run validate --root "$ROOT"
         rc="$?"
         case "$rc" in
           0) ;;
           126) echo "agent-trigger-kit validate not run; status=path_non_semver_pin"; return 126 ;;
           127) echo "agent-trigger-kit validate NOT RUN; status=interactive_validate_unverified"; return 127 ;;
           *) echo "agent-trigger-kit validate FAILED; exit=$rc"; return "$rc" ;;
         esac
       }
       run_validate
       若出現 interactive_validate_unverified 或 path_non_semver_pin，final report MUST
       列 verification gap、受影響檔案，且不得宣稱 trigger surface 已驗證；若出現
       validate FAILED，保留為真實 validate failure，不得降級成未驗證。
   - outcome record 使用 `atk_run outcome record ...`。若 helper 回 126/127，
     回報 `status=interactive_outcome_unavailable`；若 command 本身失敗，回報真實 exit code。
   - PATH/global integrity wording：
       The PATH/global tier is an opportunistic, low-integrity optimization.
       `agent-trigger-kit --version` reports the PATH binary's package version.
       Package-version equality only proves the binary declares the same package
       version as a semver pin; it is not proof of pinned-ref content equivalence.
       Non-semver pins skip the PATH tier with `status=path_non_semver_pin`.
       Version mismatches use `status=path_version_mismatch` and fall through to
       pinned external `npx`.
   - Non-Node consumer repos may use a PATH/global install instead of `node_modules/.bin`,
     but one global version cannot satisfy multiple repos pinned to different kit versions.
     CI / manual pinned external npx remains the integrity baseline.
   - 完成前跑 closeout，並遵守上方 Closeout invocation policy：
       ROOT="${ROOT:-.}"
       LOCAL_ATK="$ROOT/node_modules/.bin/agent-trigger-kit"
       PIN_FILE="$ROOT/.agent-trigger-kit/pin"
       KIT_REPO="<owner>/<repo>"
       CLOSEOUT_REPORT_SEEN=0
       CLOSEOUT_EXIT=1

       capture_command_output() {
         CAPTURE_ERREXIT=0
         case $- in
           *e*)
             CAPTURE_ERREXIT=1
             set +e
             ;;
         esac

         CAPTURE_OUTPUT="$("$@" 2>&1)"
         CAPTURE_STATUS="$?"

         if [ "$CAPTURE_ERREXIT" -eq 1 ]; then
           set -e
         fi
         return 0
       }

       run_closeout_tier() {
         if [ "$CLOSEOUT_REPORT_SEEN" -eq 1 ]; then
           return 0
         fi

         capture_command_output "$@"
         CLOSEOUT_OUTPUT="$CAPTURE_OUTPUT"
         CLOSEOUT_EXIT="$CAPTURE_STATUS"
         printf '%s\n' "$CLOSEOUT_OUTPUT"
         if printf '%s\n' "$CLOSEOUT_OUTPUT" | grep -q 'Session closeout check'; then
           CLOSEOUT_REPORT_SEEN=1
         fi
         return 0
       }

       realpath_or_same() {
         if command -v realpath >/dev/null 2>&1; then
           realpath "$1" 2>/dev/null || printf '%s' "$1"
         else
           printf '%s' "$1"
         fi
       }

       if [ -x "$LOCAL_ATK" ]; then
         run_closeout_tier "$LOCAL_ATK" session-check --closeout --root "$ROOT"
       else
         echo "agent-trigger-kit local binary missing; status=not_installed"
       fi

       if [ "$CLOSEOUT_REPORT_SEEN" -eq 0 ]; then
         PATH_ATK="$(command -v agent-trigger-kit 2>/dev/null || true)"
         LOCAL_ATK_REAL=""
         if [ -x "$LOCAL_ATK" ]; then
           LOCAL_ATK_REAL="$(realpath_or_same "$LOCAL_ATK")"
         fi

         if [ -z "$PATH_ATK" ]; then
           echo "agent-trigger-kit PATH binary missing; status=path_not_found"
         else
           PATH_ATK_REAL="$(realpath_or_same "$PATH_ATK")"
           if [ -n "$LOCAL_ATK_REAL" ] && [ "$PATH_ATK_REAL" = "$LOCAL_ATK_REAL" ]; then
             echo "agent-trigger-kit PATH binary already tried as local package; status=path_duplicate_local"
           elif [ ! -f "$PIN_FILE" ]; then
             echo "agent-trigger-kit pin missing at $PIN_FILE; status=skipped_missing_pin"
           else
             PIN_REF="$(tr -d '[:space:]' < "$PIN_FILE")"
             PIN_VERSION="$(printf '%s' "$PIN_REF" | sed 's/^[vV]//')"
             if ! printf '%s' "$PIN_REF" | grep -Eq '^[vV]?[0-9]+\.[0-9]+\.[0-9]+$'; then
               echo "agent-trigger-kit PATH fallback skipped; status=path_non_semver_pin"
             else
               capture_command_output "$PATH_ATK" --version
               PATH_VERSION_RAW="$CAPTURE_OUTPUT"
               PATH_VERSION_STATUS="$CAPTURE_STATUS"
               PATH_VERSION="$(printf '%s' "$PATH_VERSION_RAW" | tr -d '[:space:]')"
               if [ "$PATH_VERSION_STATUS" -ne 0 ] || [ -z "$PATH_VERSION" ]; then
                 echo "agent-trigger-kit PATH version unknown; status=path_version_unknown"
               elif [ "$PATH_VERSION" = "$PIN_VERSION" ]; then
                 run_closeout_tier "$PATH_ATK" session-check --closeout --root "$ROOT"
               else
                 echo "agent-trigger-kit PATH version mismatch; status=path_version_mismatch pin=$PIN_VERSION path=${PATH_VERSION:-unknown}"
               fi
             fi
           fi
         fi
       fi

       if [ "$CLOSEOUT_REPORT_SEEN" -eq 0 ]; then
         if [ ! -f "$PIN_FILE" ]; then
           echo "agent-trigger-kit pin missing at $PIN_FILE; status=skipped_missing_pin"
         else
           KIT_REF="$(tr -d '[:space:]' < "$PIN_FILE")"
           KIT_SPEC="github:${KIT_REPO}#$KIT_REF"
           run_closeout_tier npx --yes "$KIT_SPEC" session-check --closeout --root "$ROOT"
         fi
       fi

       if [ "$CLOSEOUT_REPORT_SEEN" -eq 1 ]; then
         exit "$CLOSEOUT_EXIT"
       fi

       exit 1
   - closeout blocked / failed 時，使用 not_installed、skipped_missing_pin、
     path_not_found、path_duplicate_local、path_non_semver_pin、path_version_unknown、
     path_version_mismatch、blocked_by_policy、invocation_error 這組分類，不把 sandbox
     policy block 當成 closeout fail，也不把真正的 closeout fail 降級成 policy block。

3. Renovate config：
   - 已有 → 合併，不覆蓋既有欄位/規則；沒有 → 建立 renovate.json。
   - customManagers 範本：
       {
         "customType": "regex",
         "managerFilePatterns": ["/^\\.agent-trigger-kit\\/pin$/"],
         "matchStrings": ["^(?<currentValue>v?\\d+\\.\\d+\\.\\d+)\\s*$"],
         "datasourceTemplate": "github-tags",
         "depNameTemplate": "<填 KIT_REPO 的實際字串，例如 CCC0509/agent-trigger-kit>",
         "versioningTemplate": "semver"
       }
   - depNameTemplate 必須是「實際字串」，不可留 ${KIT_REPO} 字面 ——
     Renovate config 走 Handlebars，不展開 shell 變數，留字面會產生無效 depName。
   - 目標：Renovate 能偵測 KIT_REPO 的新 tag 並自動發 PR 更新 pin。

4. CI static gate：優先併入既有 CI workflow；否則建立新 workflow。
   - 必須 on: pull_request（否則 gh pr checks --watch 無意義）。
   - KIT_REPO 以 workflow env 落地一次；步驟：
       a. 確認 .agent-trigger-kit/pin 存在
       b. 讀 pin 並防空白後組 KIT_SPEC：
            ROOT="${ROOT:-.}"
            PIN_FILE="$ROOT/.agent-trigger-kit/pin"
            KIT_REF="$(cat "$PIN_FILE")"
            test "$KIT_REF" = "$(printf '%s' "$KIT_REF" | tr -d '[:space:]')" || {
              echo "pin contains whitespace around version"; exit 1; }
            KIT_SPEC="github:${KIT_REPO}#$KIT_REF"
       c. npx --yes "$KIT_SPEC" validate --root .
       d. npx --yes "$KIT_SPEC" pin-check --strict --root .
   - validate 與 pin-check 必須「分開兩個 step」，各自獨立 exit code 與 log，不可合併成只看最後 exit code。

═══════════════════════════════════════════════
本地驗證（分項跑、分項記錄，不要混成單一 exit code）
═══════════════════════════════════════════════
- git diff --check -- <changed files>
- repo-local trigger-layer validator（若存在，例如 node scripts/validate-agent-trigger-layer.mjs）
- npx --yes "$KIT_SPEC" validate --root .
- npx --yes "$KIT_SPEC" pin-check --strict --root .
- closeout invocation proof：依 Closeout invocation policy 跑 closeout ladder；
  只有看到 Session closeout check（或 JSON 同時有 kind=session_check、mode=closeout）
  才算 closeout 真的跑過。local tier miss 先用
  `$ROOT/node_modules/.bin/agent-trigger-kit` guard 判定並回報 not_installed，再嘗試
  verified PATH/global tier；只有 semver pin 且 `agent-trigger-kit --version` package-version
  equality 時才跑 PATH closeout，否則用 path_non_semver_pin / path_version_unknown /
  path_version_mismatch breadcrumb 後落到 pinned external。若 pinned external 因 sandbox /
  approval policy 在報告前被擋，回報 blocked_by_policy；其他 no-report failure 回報
  invocation_error。
- renovate-config-validator --no-global（若可用）
- 專案自有檢查（package.json 有 scripts.check 就跑 npm run check；其他語言用其慣用 lint/test 入口）

沙箱導致 npm/tsx/npx 的 pipe/cache/network 失敗時：
- 先讀 repo AGENTS/playbook 的 escalation 段落，照該規範重跑。
- 找不到 → 直接回報失敗證據（完整 log），不要自行猜測繞過或停用檢查。

═══════════════════════════════════════════════
PR 流程
═══════════════════════════════════════════════
- local commit（conventional commit，例如 chore: pin agent-trigger-kit to <PIN_VERSION>）
- 建/沿用 branch：chore/pin-agent-trigger-kit；push（-u）
  若該 branch 因 ref namespace 或既有 branch 衝突無法建立 → 先回報原因；
  可改用 chore/pin-agent-trigger-kit-<PIN_VERSION 去掉開頭 v>，並在 PR/final 註明所用 branch 名。
- gh pr create（PR 已存在則沿用，見 Resume 段）
- PR body 必須說明：
    * 接上 ATK pinned auto-update flow，pin=<PIN_VERSION>
    * KIT_SPEC 由 pin derive（附公式）；KIT_REPO 各 surface 以常數落地
    * CI 新增 validate + pin-check --strict 兩道 gate
    * AGENTS.md 補上 closeout invocation policy；說明 blocked_by_policy 是 invocation 層 meta-status，
      不改 session-check exit code / schema。
    * Renovate 新增/合併 customManager 追蹤 pin
    * 若該 kit 版本 validator 強制文件 slug 唯一、而 repo 有 duplicate slug：
      說明做了哪個 heading rename 以通過 validator，且未改語意。（無此情況則略過，不要硬造。）
- gh pr checks <PR> --watch

CI 紅燈 / 被擋處理：
- CI 紅 → 停止、貼出失敗 log、不要 merge、不擅自改 CI 繞過。
- 判斷可 merge 性：gh pr view <PR> --json mergeStateStatus,mergeable,reviewDecision,statusCheckRollup
- 若 gh pr view 的某些 JSON 欄位在當前 gh/GraphQL 版本不支援 → 改用可用欄位確認
  state/isDraft/mergeable/reviewDecision/statusCheckRollup，不因欄位缺失就跳過 merge gate。
- 若被 branch protection / required review 擋 / checks pending / draft → 回報，不硬幹。

[暫停點 A] CI 綠後做 diff sanity check，逐項列出結果：
- .agent-trigger-kit/pin 去空白後等於 PIN_VERSION
- CI 從 pin derive KIT_SPEC（無硬編版本號）
- KIT_REPO 在各 surface 只作為常數/depNameTemplate 出現；KIT_SPEC 沒有直接硬拼 github:<repo>#<version>
- Renovate config 沒蓋掉既有設定（既有規則仍在）、customManager 欄位正確（Template key、實際 depName）
- closeout invocation policy 已寫入 AGENTS.md / Cursor 指令；報告存在與否是判定 closeout 是否跑過的真相來源，
  blocked_by_policy 只用於 external tier 在報告前被 policy / sandbox 擋下。
- docs heading rename（若有）沒改語意
列完後「停下，等我明確回覆『可以 merge』」。只有收到我明確同意，才執行：
  gh pr merge <PR> --squash --delete-branch
  （若 repo 不允許 squash，改用其允許的 merge 方式，並在回報註明。）
（若 Resume 已判定 PR 已 merge，跳過本暫停點，直接進「Merge 後」。）

═══════════════════════════════════════════════
Merge 後
═══════════════════════════════════════════════
- 同步本地 DEFAULT_BRANCH。
- 若 squash merge 造成 local 與 origin diverge：
    先 git fetch，再確認 git diff <DEFAULT_BRANCH> origin/<DEFAULT_BRANCH> 為空（tree identical）；
    「只有」tree identical 時才可 git reset --hard origin/<DEFAULT_BRANCH>。
    若 diff 不為空 → 停止、回報差異，不要 reset。
- git remote prune origin
- 確認 git status --short --branch clean
- 確認 feature branch 在 local 與 remote 都不存在（含 fallback branch 名）

═══════════════════════════════════════════════
Renovate 啟用引導
═══════════════════════════════════════════════
CLI 先查並回報：
- 是否有 self-hosted Renovate workflow（.github/workflows 內）
- 是否有 Dependency Dashboard issue（gh issue list 找 "Dependency Dashboard"）
- GitHub App installation 不要求用 CLI 強行證明；若 gh token 權限不足查不到 App 安裝狀態，
  記錄該 API/CLI 限制後，直接進入 [暫停點 B]，不要反覆重試 API。

[暫停點 B] 若我尚未告知 enabled 且 CLI 無法確認 Mend App installation，
輸出以下 Mend UI 操作步驟後「停下」，等我回「已 enabled」或「未 enabled」：
- 到 developer.mend.io
- 選 Renovate Only
- 選 Scan and Alert
- 選 repo：<CONSUMER_REPO>
- 在 developer.mend.io 確認該 repo 顯示 enabled
明確區分「CLI 已證明」與「需我人工確認」。不要宣稱自己已確認 UI enabled。
（若我在本輪已明確告知 enabled，視為本暫停點完成，直接 final closeout。）

═══════════════════════════════════════════════
最後回報（逐項）
═══════════════════════════════════════════════
- 修改/merge 的檔案清單
- PR URL / merge commit SHA / pin 目前版本 / 實際使用的 branch 名
- validate 結果（獨立 exit code 與摘要）
- pin-check 結果（獨立 exit code 與摘要）
- closeout invocation 結果：report present / not_installed / skipped_missing_pin / path_not_found /
  path_duplicate_local / path_non_semver_pin / path_version_unknown / path_version_mismatch /
  blocked_by_policy / invocation_error，
  並附關鍵證據；若 report present，列出 exit code。
- interactive local-first 結果：session-check / pin-check 若被 skip，列出
  interactive_skipped_local_first 或 path_non_semver_pin；validate 若未跑，列出
  interactive_validate_unverified、受影響檔案與 verification gap；outcome record 若不可用，
  列出 interactive_outcome_unavailable。不得把 validate FAILED 降級成未驗證。
- CI 結果
- Renovate config 是「新增」還是「合併」
- local/remote branch cleanup 結果
- 最終 git status --short --branch
- deploy/smoke：不需要，並說明原因
- Renovate UI：依我回覆記為「已 enabled」或「未 enabled + 下一步」
```

## Existing v4-final Repos Closeout Addendum

Use this when a consumer repo already completed `Prompt (v4-final)` and only needs
the closeout invocation policy update.

```text
This repo already ran Agent Trigger Kit Prompt (v4-final).

Do not rerun the full pin/Renovate/CI setup. Do not change `.agent-trigger-kit/pin`, Renovate, or CI unless they are currently missing or broken. Do not open a second pin setup PR.

Goal: add the Agent Trigger Kit closeout invocation policy to this repo's agent
instructions only.

Precheck:
- Read AGENTS.md / CLAUDE.md / Cursor rules if present and follow their local rules.
- Report git status --short --branch.
- Confirm `.agent-trigger-kit/pin` exists.
- Derive KIT_SPEC from the existing pin:
    ROOT="${ROOT:-.}"
    KIT_REPO="<owner>/<repo>"
    PIN_FILE="$ROOT/.agent-trigger-kit/pin"
    KIT_REF="$(tr -d '[:space:]' < "$PIN_FILE")"
    KIT_SPEC="github:${KIT_REPO}#$KIT_REF"
- Check whether AGENTS.md / CLAUDE.md / Cursor already document closeout invocation policy.

Implementation:
- Update AGENTS.md / CLAUDE.md / Cursor instructions where this repo documents Agent Trigger Kit checks.
- Add this closeout rule:
    * A closeout attempt counts as having run only when output includes `Session closeout check`.
    * If JSON output is used, require both `"kind": "session_check"` and `"mode": "closeout"`.
    * If a closeout report appears, trust its exit code. Do not run a later tier to hide a nonzero result.
    * Use tiers in this order: local binary, verified PATH/global package, then pinned external `npx`.
    * The PATH/global tier is an opportunistic, low-integrity optimization.
      `agent-trigger-kit --version` reports the PATH binary's package version.
      The PATH tier invokes `$PATH_ATK --version` after `command -v agent-trigger-kit`
      resolves the binary. Package-version equality only proves the binary declares
      the same package version as a semver pin; it is not proof of pinned-ref content
      equivalence.
    * Non-semver pins skip the PATH tier with `status=path_non_semver_pin`.
      Version mismatches use `status=path_version_mismatch` and fall through to
      pinned external `npx`.
    * For normal consumer repos, do not use `npx --no-install agent-trigger-kit ...`
      as the installed-package tier; local misses can enter npm registry resolution. Use
      this first-report-wins self-chaining ladder:
        ROOT="${ROOT:-.}"
        LOCAL_ATK="$ROOT/node_modules/.bin/agent-trigger-kit"
        PIN_FILE="$ROOT/.agent-trigger-kit/pin"
        KIT_REPO="<owner>/<repo>"
        CLOSEOUT_REPORT_SEEN=0
        CLOSEOUT_EXIT=1

        capture_command_output() {
          CAPTURE_ERREXIT=0
          case $- in
            *e*)
              CAPTURE_ERREXIT=1
              set +e
              ;;
          esac

          CAPTURE_OUTPUT="$("$@" 2>&1)"
          CAPTURE_STATUS="$?"

          if [ "$CAPTURE_ERREXIT" -eq 1 ]; then
            set -e
          fi
          return 0
        }

        run_closeout_tier() {
          if [ "$CLOSEOUT_REPORT_SEEN" -eq 1 ]; then
            return 0
          fi

          capture_command_output "$@"
          CLOSEOUT_OUTPUT="$CAPTURE_OUTPUT"
          CLOSEOUT_EXIT="$CAPTURE_STATUS"
          printf '%s\n' "$CLOSEOUT_OUTPUT"
          if printf '%s\n' "$CLOSEOUT_OUTPUT" | grep -q 'Session closeout check'; then
            CLOSEOUT_REPORT_SEEN=1
          fi
          return 0
        }

        realpath_or_same() {
          if command -v realpath >/dev/null 2>&1; then
            realpath "$1" 2>/dev/null || printf '%s' "$1"
          else
            printf '%s' "$1"
          fi
        }

        if [ -x "$LOCAL_ATK" ]; then
          run_closeout_tier "$LOCAL_ATK" session-check --closeout --root "$ROOT"
        else
          echo "agent-trigger-kit local binary missing; status=not_installed"
        fi

        if [ "$CLOSEOUT_REPORT_SEEN" -eq 0 ]; then
          PATH_ATK="$(command -v agent-trigger-kit 2>/dev/null || true)"
          LOCAL_ATK_REAL=""
          if [ -x "$LOCAL_ATK" ]; then
            LOCAL_ATK_REAL="$(realpath_or_same "$LOCAL_ATK")"
          fi

          if [ -z "$PATH_ATK" ]; then
            echo "agent-trigger-kit PATH binary missing; status=path_not_found"
          else
            PATH_ATK_REAL="$(realpath_or_same "$PATH_ATK")"
            if [ -n "$LOCAL_ATK_REAL" ] && [ "$PATH_ATK_REAL" = "$LOCAL_ATK_REAL" ]; then
              echo "agent-trigger-kit PATH binary already tried as local package; status=path_duplicate_local"
            elif [ ! -f "$PIN_FILE" ]; then
              echo "agent-trigger-kit pin missing at $PIN_FILE; status=skipped_missing_pin"
            else
              PIN_REF="$(tr -d '[:space:]' < "$PIN_FILE")"
              PIN_VERSION="$(printf '%s' "$PIN_REF" | sed 's/^[vV]//')"
              if ! printf '%s' "$PIN_REF" | grep -Eq '^[vV]?[0-9]+\.[0-9]+\.[0-9]+$'; then
                echo "agent-trigger-kit PATH fallback skipped; status=path_non_semver_pin"
              else
                capture_command_output "$PATH_ATK" --version
                PATH_VERSION_RAW="$CAPTURE_OUTPUT"
                PATH_VERSION_STATUS="$CAPTURE_STATUS"
                PATH_VERSION="$(printf '%s' "$PATH_VERSION_RAW" | tr -d '[:space:]')"
                if [ "$PATH_VERSION_STATUS" -ne 0 ] || [ -z "$PATH_VERSION" ]; then
                  echo "agent-trigger-kit PATH version unknown; status=path_version_unknown"
                elif [ "$PATH_VERSION" = "$PIN_VERSION" ]; then
                  run_closeout_tier "$PATH_ATK" session-check --closeout --root "$ROOT"
                else
                  echo "agent-trigger-kit PATH version mismatch; status=path_version_mismatch pin=$PIN_VERSION path=${PATH_VERSION:-unknown}"
                fi
              fi
            fi
          fi
        fi

        if [ "$CLOSEOUT_REPORT_SEEN" -eq 0 ]; then
          if [ ! -f "$PIN_FILE" ]; then
            echo "agent-trigger-kit pin missing at $PIN_FILE; status=skipped_missing_pin"
          else
            KIT_REF="$(tr -d '[:space:]' < "$PIN_FILE")"
            KIT_SPEC="github:${KIT_REPO}#$KIT_REF"
            run_closeout_tier npx --yes "$KIT_SPEC" session-check --closeout --root "$ROOT"
          fi
        fi

        if [ "$CLOSEOUT_REPORT_SEEN" -eq 1 ]; then
          exit "$CLOSEOUT_EXIT"
        fi

        exit 1
    * The ladder preserves the first-report-wins rule mechanically. If no closeout
      report appears after all tiers, the no-report path exits 1. It temporarily
      disables and restores `errexit` around output captures, so nonzero closeout
      reports still print and set the first-report marker under `set -e`.
    * If no report appears:
        - local package missing → `not_installed`, then try PATH/global and pinned external
        - PATH binary missing, PATH duplicate-local, non-semver pin, unknown PATH
          version, or PATH version mismatch → treat the PATH tier as a skipped
          optimization and continue to pinned external `npx`
        - missing pin → `skipped_missing_pin`
        - explicit sandbox / approval / host policy denial before report → `blocked_by_policy`
        - network / npm cache / package resolution / unknown failure → `invocation_error`
        - ambiguous no-report failures default to invocation_error

Verification:
- `git diff --check -- <changed files>`
- `npx --yes "$KIT_SPEC" validate --root .`
- `npx --yes "$KIT_SPEC" pin-check --strict --root .`
- Run the repo's normal docs/check command if one exists.

PR / final report:
- Commit only the instruction/doc changes.
- PR title suggestion: `docs: add agent-trigger-kit closeout invocation policy`
- State that this is a v4-final addendum, not a pin/Renovate/CI rerun.
- Report validate, pin-check, closeout invocation evidence, and final git status.
```

## Existing v7-verified-path-fallback Repos Interactive Local-First Addendum

Use this when a consumer repo already completed `Prompt (v7-verified-path-fallback)`
and only needs the interactive local-first session-start / validate / outcome update.

```text
This repo already ran Agent Trigger Kit Prompt (v7-verified-path-fallback).

Do not rerun the full pin/Renovate/CI setup. Do not change `.agent-trigger-kit/pin`, Renovate, or CI unless they are currently missing or broken. Do not open a second pin setup PR.

Goal: update only AGENTS.md / Cursor / Claude hook instructions so interactive checks prefer local/PATH execution and do not auto-fetch pinned external packages in sandboxed sessions.

Precheck:
- Read AGENTS.md / CLAUDE.md / Cursor rules if present and follow their local rules.
- Report git status --short --branch.
- Confirm `.agent-trigger-kit/pin` exists.
- Confirm closeout invocation policy already exists. Do not rewrite the closeout ladder unless it is missing or broken.

Implementation:
- Update session-start instructions to use this helper instead of direct external package execution:
    ROOT="${ROOT:-.}"
    LOCAL_ATK="$ROOT/node_modules/.bin/agent-trigger-kit"
    PIN_FILE="$ROOT/.agent-trigger-kit/pin"
    PIN_REF="$(tr -d '[:space:]' < "$PIN_FILE" 2>/dev/null || true)"
    PATH_ATK="$(command -v agent-trigger-kit 2>/dev/null || true)"

    atk_run() {
      if [ -x "$LOCAL_ATK" ]; then "$LOCAL_ATK" "$@"; return $?; fi
      if ! printf '%s' "$PIN_REF" | grep -Eq '^[vV]?[0-9]+\.[0-9]+\.[0-9]+$'; then return 126; fi
      PIN_VERSION="$(printf '%s' "$PIN_REF" | sed 's/^[vV]//')"
      if [ -n "$PATH_ATK" ] && [ "$("$PATH_ATK" --version 2>/dev/null | tr -d '[:space:]')" = "$PIN_VERSION" ]; then
        "$PATH_ATK" "$@"; return $?
      fi
      return 127
    }

    run_advisory() {
      label="$1"; shift
      atk_run "$@"; rc="$?"
      case "$rc" in
        0) ;;
        126) echo "agent-trigger-kit $label not run; status=path_non_semver_pin" ;;
        127) echo "agent-trigger-kit $label not run; status=interactive_skipped_local_first" ;;
        *) echo "agent-trigger-kit $label failed; exit=$rc" ;;
      esac
    }

    run_advisory session-check session-check --root "$ROOT"
    run_advisory pin-check pin-check --no-outcome --root "$ROOT"
- Update validate instructions to use explicit exit-code dispatch:
    run_validate() {
      atk_run validate --root "$ROOT"
      rc="$?"
      case "$rc" in
        0) ;;
        126) echo "agent-trigger-kit validate not run; status=path_non_semver_pin"; return 126 ;;
        127) echo "agent-trigger-kit validate NOT RUN; status=interactive_validate_unverified"; return 127 ;;
        *) echo "agent-trigger-kit validate FAILED; exit=$rc"; return "$rc" ;;
      esac
    }
  A true validate failure must remain `validate FAILED; exit=$rc`. Only 126/127 are
  unverified interactive states. Final reports must list affected trigger files
  and a verification gap when validation is unverified.
- Update outcome record instructions to use `atk_run outcome record ...`; if helper
  resolution returns 126/127, report `status=interactive_outcome_unavailable`, but
  keep real command failures as real failures.
- For Claude PostToolUse hooks, default missing local/PATH validation to warning +
  exit 0. Strict blocking is opt-in with `ATK_STRICT_VALIDATE="${ATK_STRICT_VALIDATE:-0}"`
  changed to `1` in `.claude/settings.local.json`.
- Non-Node repos may use a PATH/global install, but one global version cannot match
  multiple repos pinned to different kit versions. PATH version equality is
  convenience, not pinned-ref proof.
- Do not change CI. CI keeps pinned external package execution as the integrity
  baseline for validate and pin-check.

Verification:
- `git diff --check -- <changed files>`
- Run the repo's focused docs/instruction tests if they exist.
- Run the repo's normal preflight before committing when available.

PR / final report:
- Commit only instruction/doc/test changes.
- State that this is a v7 interactive local-first addendum, not a pin/Renovate/CI rerun.
- Report any interactive_validate_unverified / path_non_semver_pin / interactive_outcome_unavailable statuses as verification gaps, not successes.
```

## Changelog

- **v7.1-interactive-local-first** — changed: interactive local-first policy for
  Codex/AGENTS, Cursor, and Claude hook examples to prefer local/PATH execution
  for session-start,
  `pin-check --no-outcome`, `validate`, and outcome recording instead of
  auto-fetching pinned external packages in sandboxed sessions; validate callers
  must dispatch exit codes so real drift remains `validate FAILED` while only
  helper resolution states become verification gaps. Future: publishing the kit
  to npm would let consumer repos use normal package-lock/cache behavior and
  remove much of this helper policy.
- **v7-verified-path-fallback** — changed: closeout ladders now try a verified PATH fallback
  between the local binary and pinned external `npx`; package-version
  equality is opportunistic/low-integrity and not proof of pinned-ref content
  equivalence; non-semver pins skip the PATH tier with `path_non_semver_pin`, while
  PATH version mismatches leave `path_version_mismatch` breadcrumbs before falling
  through to pinned external.
- **v6-localbin-guard** — changed: live closeout ladders now use a root-aware
  local-bin guard (`$ROOT/node_modules/.bin/agent-trigger-kit`) before pinned
  fallback; `KIT_SPEC` derivation is root-aware through `PIN_FILE` and
  whitespace-stripped through `KIT_REF`; local misses report `not_installed`
  without relying on `npx --no-install` registry behavior.
- **v5-closeout-policy** — added: closeout invocation policy for AGENTS/Cursor/final
  reporting; report-presence rule (`Session closeout check`, or JSON
  `kind=session_check` + `mode=closeout`); consumer closeout ladder
  (`npx --no-install` → pinned `npx --yes "$KIT_SPEC"`); no-report status taxonomy
  (`not_installed`, `skipped_missing_pin`, `blocked_by_policy`, `invocation_error`);
  existing-v4 migration addendum so repos that already ran v4-final do not rerun
  pin/Renovate/CI setup.
- **v4-final** — added: filled-value hard check at top + precheck; feature-branch name
  conflict fallback (`chore/pin-agent-trigger-kit-<version>`); explicit PR lookup by head
  branch; `gh pr view` JSON field fallback so a missing field never skips the merge gate;
  Renovate App "don't hammer the API, go to Pause B" rule.
