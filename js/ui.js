// ============================================
// ui.js
// Character Manager - 공용 UI 유틸리티
// ============================================
//
// 모든 페이지(index.html, status.html, dice.html, battle.html)에서
// 공통으로 쓸 수 있는 UI 헬퍼 모음입니다.
//
// 제공 기능
// 1) UI.toast(message, type, duration)   - 하단 토스트 알림
// 2) UI.confirm(message)                 - Promise 기반 커스텀 확인창
// 3) UI.showLoading(text) / hideLoading  - 로딩 오버레이
// 4) UI.highlightNav()                   - 현재 페이지 nav 자동 활성화
// 5) UI.rankInfo(rank) / UI.formatRoll() - 판정 결과 → 이모지/색상 클래스
// 6) UI.debounce(fn, delay)              - 디바운스 유틸
//
// 별도 CSS 파일 수정 없이 동작하도록, 필요한 스타일은
// 이 스크립트가 <style id="ui-injected-style"> 로 직접 주입합니다.
// (이미 style.css에 정의된 색상 변수 --color-* 를 그대로 재사용합니다)
// ============================================

const UI = (() => {

    // ----------------------------------------
    // 판정 등급 → 이모지 / 색상 클래스
    // (index.html의 "판정 규칙" 섹션과 동일한 기준)
    // ----------------------------------------

    const RANK_INFO = {

        "대성공": { emoji: "🎉", className: "roll-critical" },
        "극단적 성공": { emoji: "💎", className: "roll-critical" },
        "어려운 성공": { emoji: "⭐", className: "roll-success" },
        "성공": { emoji: "✅", className: "roll-success" },
        "실패": { emoji: "❌", className: "roll-fail" },
        "대실패": { emoji: "💀", className: "roll-fumble" }

    };

    function rankInfo(rank) {

        return RANK_INFO[rank] ?? { emoji: "", className: "" };

    }

    function formatRoll(result) {

        const info = rankInfo(result.rank);

        return `${info.emoji} ${result.dice} / ${result.target} → `
            + `<span class="${info.className}">${result.rank}</span>`;

    }

    // ----------------------------------------
    // 필요한 CSS 1회 주입
    // ----------------------------------------

    function injectStyles() {

        if (document.getElementById("ui-injected-style")) return;

        const style = document.createElement("style");

        style.id = "ui-injected-style";

        style.textContent = `

            #uiToastContainer {
                position: fixed;
                left: 50%;
                bottom: 24px;
                transform: translateX(-50%);
                display: flex;
                flex-direction: column;
                gap: 8px;
                z-index: 9999;
                pointer-events: none;
            }

            .ui-toast {
                min-width: 220px;
                max-width: 360px;
                padding: 12px 18px;
                border-radius: 999px;
                background: var(--color-primary, #333);
                color: #fff;
                font-weight: 700;
                font-size: 0.9rem;
                text-align: center;
                box-shadow: 0 4px 14px rgba(0,0,0,0.25);
                opacity: 0;
                transform: translateY(10px);
                transition: opacity 0.2s ease, transform 0.2s ease;
            }

            .ui-toast.show {
                opacity: 1;
                transform: translateY(0);
            }

            .ui-toast.info { background: var(--color-primary, #333); }
            .ui-toast.success { background: var(--color-accent, #4caf6e); }
            .ui-toast.error { background: var(--color-danger, #d4453a); }
            .ui-toast.warning {
                background: var(--color-warning, #e0b03e);
                color: #2b1c12;
            }

            #uiModalOverlay {
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.5);
                display: none;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            }

            #uiModalOverlay.show {
                display: flex;
            }

            .ui-modal-box {
                background: var(--color-surface, #fff);
                color: var(--color-text, #222);
                border-radius: 16px;
                padding: 24px;
                max-width: 340px;
                width: 90%;
                text-align: center;
                box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            }

            .ui-modal-message {
                margin-bottom: 18px;
                font-size: 0.95rem;
                line-height: 1.5;
                white-space: pre-wrap;
            }

            .ui-modal-actions {
                display: flex;
                gap: 10px;
                justify-content: center;
            }

            .ui-modal-actions button {
                flex: 1;
            }

            #uiLoadingOverlay {
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.35);
                display: none;
                align-items: center;
                justify-content: center;
                z-index: 10001;
                flex-direction: column;
                gap: 12px;
                color: #fff;
                font-weight: 700;
            }

            #uiLoadingOverlay.show {
                display: flex;
            }

            .ui-spinner {
                width: 36px;
                height: 36px;
                border: 4px solid rgba(255,255,255,0.3);
                border-top-color: #fff;
                border-radius: 50%;
                animation: ui-spin 0.8s linear infinite;
            }

            @keyframes ui-spin {
                to { transform: rotate(360deg); }
            }

            .roll-success { color: var(--color-primary, #2e7d32); font-weight: 700; }
            .roll-fail { color: var(--color-text-muted, #888); }
            .roll-critical { color: var(--color-warning, #e0b03e); font-weight: 800; }
            .roll-fumble { color: var(--color-danger, #c0392b); font-weight: 800; }

        `;

        document.head.appendChild(style);

    }

    // ----------------------------------------
    // 토스트 알림
    // ----------------------------------------

    function getToastContainer() {

        let container = document.getElementById("uiToastContainer");

        if (!container) {

            container = document.createElement("div");

            container.id = "uiToastContainer";

            document.body.appendChild(container);

        }

        return container;

    }

    function toast(message, type = "info", duration = 2500) {

        injectStyles();

        const container = getToastContainer();

        const el = document.createElement("div");

        el.className = `ui-toast ${type}`;

        el.textContent = message;

        container.appendChild(el);

        requestAnimationFrame(() => {

            el.classList.add("show");

        });

        setTimeout(() => {

            el.classList.remove("show");

            setTimeout(() => el.remove(), 250);

        }, duration);

    }

    // ----------------------------------------
    // 커스텀 확인창 (Promise 기반)
    // ----------------------------------------

    function getModalOverlay() {

        let overlay = document.getElementById("uiModalOverlay");

        if (!overlay) {

            overlay = document.createElement("div");

            overlay.id = "uiModalOverlay";

            overlay.innerHTML = `
                <div class="ui-modal-box">
                    <div class="ui-modal-message"></div>
                    <div class="ui-modal-actions"></div>
                </div>
            `;

            document.body.appendChild(overlay);

        }

        return overlay;

    }

    function confirmDialog(message, okText = "확인", cancelText = "취소") {

        injectStyles();

        return new Promise(resolve => {

            const overlay = getModalOverlay();

            overlay.querySelector(".ui-modal-message").textContent = message;

            const actions = overlay.querySelector(".ui-modal-actions");

            actions.innerHTML = "";

            const btnCancel = document.createElement("button");

            btnCancel.textContent = cancelText;

            const btnOk = document.createElement("button");

            btnOk.textContent = okText;

            btnOk.className = "btn-primary";

            function close(result) {

                overlay.classList.remove("show");

                resolve(result);

            }

            btnCancel.addEventListener("click", () => close(false));

            btnOk.addEventListener("click", () => close(true));

            actions.appendChild(btnCancel);

            actions.appendChild(btnOk);

            overlay.classList.add("show");

        });

    }

    // ----------------------------------------
    // 로딩 오버레이
    // ----------------------------------------

    function getLoadingOverlay() {

        let overlay = document.getElementById("uiLoadingOverlay");

        if (!overlay) {

            overlay = document.createElement("div");

            overlay.id = "uiLoadingOverlay";

            overlay.innerHTML = `
                <div class="ui-spinner"></div>
                <div class="ui-loading-text"></div>
            `;

            document.body.appendChild(overlay);

        }

        return overlay;

    }

    function showLoading(text = "처리중...") {

        injectStyles();

        const overlay = getLoadingOverlay();

        overlay.querySelector(".ui-loading-text").textContent = text;

        overlay.classList.add("show");

    }

    function hideLoading() {

        const overlay = document.getElementById("uiLoadingOverlay");

        if (overlay) overlay.classList.remove("show");

    }

    // ----------------------------------------
    // 현재 페이지 네비게이션 활성화
    // (.nav-btn 방식 / <header><nav> 방식 둘 다 지원)
    // ----------------------------------------

    function highlightNav() {

        const current = location.pathname.split("/").pop() || "index.html";

        document.querySelectorAll(".nav-btn, .header nav a").forEach(link => {

            const href = link.getAttribute("href");

            if (!href) return;

            if (href === current) {

                link.classList.add("active");

            }

            else {

                link.classList.remove("active");

            }

        });

    }

    // ----------------------------------------
    // 디바운스
    // ----------------------------------------

    function debounce(fn, delay = 300) {

        let timer = null;

        return (...args) => {

            clearTimeout(timer);

            timer = setTimeout(() => fn(...args), delay);

        };

    }

    // ----------------------------------------
    // 초기화
    // ----------------------------------------

    document.addEventListener("DOMContentLoaded", () => {

        injectStyles();

        highlightNav();

    });

    // ----------------------------------------
    // 반환
    // ----------------------------------------

    return {

        toast,

        confirm: confirmDialog,

        showLoading,

        hideLoading,

        highlightNav,

        rankInfo,

        formatRoll,

        debounce

    };

})();

console.log("UI Helper Ready");