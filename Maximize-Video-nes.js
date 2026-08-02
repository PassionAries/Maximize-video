// ==UserScript==
// @name                Maximize Video
// @name:zh-CN          视频网页全屏
// @namespace           
// @description         Maximize all video players. Support Picture-in-picture.
// @description:zh-CN   让所有视频网页全屏，开启画中画与倍速调整功能
// @author              冻猫
// @include             *
// @exclude             *www.w3school.com.cn*
// @grant               none
// @version             12.7
// @license             MIT
// @run-at              document-end
// ==/UserScript==

;(() => {
  "use strict"

  // 当页面 CSP 阻止注入时，Tampermonkey 会把脚本放进 userscript.html 扩展页面沙箱中运行。
  // 此时 location.protocol 为 chrome-extension:/moz-extension: 等，DOM 与目标页面完全隔离，
  // 继续执行会触发 "(intermediate value) is not a function" 之类异常，因此直接安全退出。
  const proto = (location.protocol || "").toLowerCase()
  if (proto === "chrome-extension:" || proto === "moz-extension:" || proto === "safari-extension:") {
    return
  }

  const gv = {
    isFull: false,
    isIframe: false,
    autoCheckCount: 0,
    player: null,
    mouseoverEl: null,
    playerChilds: [],
    playerParents: [],
    controlBtn: null,
    picinpicBtn: null,
    speedBtn: null,
    leftBtn: null,
    rightBtn: null,
    backHtmlId: "",
    backBodyId: "",
    backControls: false,
    ytbStageChange: false,
    scrollFixTimer: 0,
    speedRate: 1,
    speedList: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3],
    alwaysShow: false,
    autoScanTimer: 0,
    trustedHTML: null,
  }

  //Html5规则[播放器最外层],适用于无法自动识别的自适应大小HTML5播放器
  const html5Rules = {
    "www.acfun.cn": [".player-container .player"],
    "www.bilibili.com": ["#bilibiliPlayer"],
    "www.douyu.com": ["#js-player-video-case"],
    "www.huya.com": ["#videoContainer"],
    "www.twitch.tv": [".player"],
    "www.youtube.com": ["#movie_player", "#ytd-player"],
    "www.yy.com": ["#player"],
    "www.miguvideo.com": ["#mod-player"],
    "*weibo.com": ['[aria-label="Video Player"]', ".html5-video-live .html5-video"],
    "v.huya.com": ["#video_embed_flash>div"],
  }

  //通用html5播放器
  const generalPlayerRules = [".dplayer", ".video-js", ".jwplayer", "[data-player]"]

  try {
    if (window.top !== window.self) {
      gv.isIframe = true
    }
  } catch (e) {
    gv.isIframe = false
  }

  if ((navigator.language || "").toLowerCase() == "zh-cn") {
    gv.btnText = {
      max: "网页全屏",
      pip: "画中画",
      tip: "Iframe内视频，请用鼠标点击视频后重试",
    }
  } else {
    gv.btnText = {
      max: "Maximize",
      pip: "PicInPic",
      tip: "Iframe video. Please click on the video and try again",
    }
  }

  const tool = {
    print(log) {
      try {
        const now = new Date()
        const pad = (n) => (n < 10 ? "0" : "") + n
        const timenow =
          "[" + now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + " " + pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds()) + "]"
        console.log(timenow + "[Maximize Video] > " + log)
      } catch (e) {}
    },
    delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    },
    getRect(element) {
      if (!element || typeof element.getBoundingClientRect != "function") {
        return { pageX: 0, pageY: 0, screenX: 0, screenY: 0 }
      }
      const rect = element.getBoundingClientRect()
      const scroll = tool.getScroll()
      return {
        pageX: rect.left + scroll.left,
        pageY: rect.top + scroll.top,
        screenX: rect.left,
        screenY: rect.top,
      }
    },
    isHalfFullClient(element) {
      if (!element) return false
      const client = tool.getClient()
      const rect = tool.getRect(element)
      if (
        (Math.abs(client.width - element.offsetWidth) < 21 && rect.screenX < 20) ||
        (Math.abs(client.height - element.offsetHeight) < 21 && rect.screenY < 10)
      ) {
        if (
          Math.abs(element.offsetWidth / 2 + rect.screenX - client.width / 2) < 21 &&
          Math.abs(element.offsetHeight / 2 + rect.screenY - client.height / 2) < 21
        ) {
          return true
        } else {
          return false
        }
      } else {
        return false
      }
    },
    isAllFullClient(element) {
      if (!element) return false
      const client = tool.getClient()
      const rect = tool.getRect(element)
      if (
        Math.abs(client.width - element.offsetWidth) < 21 &&
        rect.screenX < 20 &&
        Math.abs(client.height - element.offsetHeight) < 21 &&
        rect.screenY < 10
      ) {
        return true
      } else {
        return false
      }
    },
    getScroll() {
      try {
        return {
          left: document.documentElement.scrollLeft || document.body.scrollLeft,
          top: document.documentElement.scrollTop || document.body.scrollTop,
        }
      } catch (e) {
        return { left: 0, top: 0 }
      }
    },
    getClient() {
      try {
        return {
          width: document.compatMode == "CSS1Compat" ? document.documentElement.clientWidth : document.body.clientWidth,
          height: document.compatMode == "CSS1Compat" ? document.documentElement.clientHeight : document.body.clientHeight,
        }
      } catch (e) {
        return { width: 0, height: 0 }
      }
    },
    addStyle(css) {
      try {
        const style = document.createElement("style")
        style.type = "text/css"
        style.appendChild(document.createTextNode(css))
        const head = document.querySelector("head") || document.documentElement
        if (head && head.appendChild) head.appendChild(style)
        return style
      } catch (e) {
        return null
      }
    },
    matchRule(str, rule) {
      try {
        return new RegExp("^" + String(rule).split("*").join(".*") + "$").test(str)
      } catch (e) {
        return false
      }
    },
    isYoutube() {
      const h = (document.location.hostname || "").toLowerCase()
      return h == "www.youtube.com" || h == "youtube.com" || h.slice(-12) == ".youtube.com"
    },
    isBilibili() {
      const h = (document.location.hostname || "").toLowerCase()
      return h == "bilibili.com" || h.slice(-13) == ".bilibili.com"
    },
    // Trusted Types 兼容的安全 innerHTML 赋值（v12.6 改进，修复同名 policy 重复创建问题）
    setHTML(el, str) {
      try {
        if (gv.trustedHTML && typeof gv.trustedHTML.createHTML == "function") {
          el.innerHTML = gv.trustedHTML.createHTML(str)
        } else {
          el.innerHTML = str
        }
      } catch (e) {}
    },
    createButton(id) {
      const btn = document.createElement("div")
      btn.id = id
      btn.onclick = () => {
        try {
          maximize.playerControl()
        } catch (e) {
          tool.print(e && e.message)
        }
      }
      if (document.body) document.body.appendChild(btn)
      return btn
    },
      async addTip(str) {
        try {
          if (document.getElementById("catTip")) return
          const tip = document.createElement("div")
          tip.id = "catTip"
          tool.setHTML(tip, str)
        tip.style.cssText =
          "transition: all 0.8s ease-out;background: none repeat scroll 0 0 #27a9d8;color: #FFFFFF;font: 1.1em '微软雅黑';margin-left: -250px;overflow: hidden;padding: 10px;position: fixed;text-align: center;bottom: 100px;z-index: 300;display: block;"
        if (document.body) document.body.appendChild(tip)
        tip.style.right = -tip.offsetWidth - 5 + "px"
        await tool.delay(300)
        tip.style.right = "25px"
        await tool.delay(3500)
        tip.style.right = -tip.offsetWidth - 5 + "px"
        await tool.delay(1000)
        if (tip.parentNode) document.body.removeChild(tip)
      } catch (e) {
        tool.print("addTip: " + (e && e.message))
      }
    },
  }

  const setButton = {
    init() {
      if (!document.getElementById("playerControlBtn")) {
        try {
          init()
        } catch (e) {
          tool.print("init: " + (e && e.message))
        }
      }
      if (gv.isIframe && gv.player && tool.isHalfFullClient(gv.player)) {
        window.parent.postMessage("iframeVideo", "*")
        return
      }
      this.show()
    },
    show() {
      if (!gv.player || !gv.controlBtn) return
      gv.player.removeEventListener("mouseleave", handle.leavePlayer, false)
      gv.player.addEventListener("mouseleave", handle.leavePlayer, false)

      if (!gv.isFull) {
        document.removeEventListener("scroll", handle.scrollFix, false)
        document.addEventListener("scroll", handle.scrollFix, false)
      }
      gv.controlBtn.style.display = "block"
      gv.controlBtn.style.visibility = "visible"
      if (document.pictureInPictureEnabled && gv.player.nodeName != "OBJECT" && gv.player.nodeName != "EMBED") {
        gv.picinpicBtn.style.display = "block"
        gv.picinpicBtn.style.visibility = "visible"
        gv.speedBtn.style.display = "block"
        gv.speedBtn.style.visibility = "visible"
      }
      handle.setSpeed(gv.speedRate, false)
      this.locate()
    },
    locate() {
      if (!gv.player) return
      const playerRect = tool.getRect(gv.player)
      // 播放器顶部贴近视口顶部(theater 模式等)时把按钮放到播放器内部，避免跑到屏幕外被遮住
      const inner = playerRect.screenY < 40
      const top = inner ? playerRect.screenY + 8 : playerRect.screenY - 24
      const right = playerRect.screenX + (gv.player.offsetWidth || 0)

      gv.controlBtn.style.opacity = "0.5"
      tool.setHTML(gv.controlBtn, gv.btnText.max)
      gv.controlBtn.style.top = top + "px"
      gv.controlBtn.style.left = right - 64 + "px"

      gv.picinpicBtn.style.opacity = "0.5"
      tool.setHTML(gv.picinpicBtn, gv.btnText.pip)
      gv.picinpicBtn.style.top = top + "px"
      gv.picinpicBtn.style.left = right - 119 + "px"

      gv.speedBtn.style.opacity = "0.5"
      tool.setHTML(gv.speedBtn, gv.speedRate + "x")
      gv.speedBtn.style.top = top + "px"
      gv.speedBtn.style.left = right - 171 + "px"
    },
  }

  const handle = {
    getPlayer(e) {
      if (gv.isFull || !e) return
      const target = e.target
      if (!target || typeof target.nodeName == "undefined") return
      gv.mouseoverEl = target
      const hostname = document.location.hostname
      let players = []
      for (let i in html5Rules) {
        if (tool.matchRule(hostname, i)) {
          const rules = html5Rules[i]
          for (let r = 0; r < rules.length; r++) {
            const nodes = document.querySelectorAll(rules[r])
            if (nodes.length > 0) {
              for (let n = 0; n < nodes.length; n++) players.push(nodes[n])
            }
          }
          break
        }
      }
      if (players.length == 0) {
        for (let r = 0; r < generalPlayerRules.length; r++) {
          const nodes = document.querySelectorAll(generalPlayerRules[r])
          if (nodes.length > 0) {
            for (let n = 0; n < nodes.length; n++) players.push(nodes[n])
          }
        }
      }
      if (players.length == 0 && target.nodeName != "VIDEO") {
        const videos = document.querySelectorAll("video")
        if (videos.length > 0) {
          for (let n = 0; n < videos.length; n++) {
            const v = videos[n]
            const vRect = v.getBoundingClientRect()
            if (
              e.clientX >= vRect.x - 2 &&
              e.clientX <= vRect.x + vRect.width + 2 &&
              e.clientY >= vRect.y - 2 &&
              e.clientY <= vRect.y + vRect.height + 2 &&
              v.offsetWidth > 399 &&
              v.offsetHeight > 220
            ) {
              players = []
              players[0] = handle.autoCheck(v)
              gv.autoCheckCount = 1
              break
            }
          }
        }
      }
      if (players.length > 0) {
        let path = []
        try {
          path = e.path || (typeof e.composedPath == "function" ? e.composedPath() : []) || []
        } catch (err) {
          path = []
        }
        for (let n = 0; n < players.length; n++) {
          if (path.indexOf(players[n]) > -1) {
            gv.player = players[n]
            setButton.init()
            return
          }
        }
      }
      switch (target.nodeName) {
        case "VIDEO":
        case "OBJECT":
        case "EMBED":
          if (target.offsetWidth > 399 && target.offsetHeight > 220) {
            gv.player = target
            setButton.init()
          }
          break
        default:
          handle.leavePlayer()
      }
    },
    autoCheck(v) {
      let tempPlayer = null
      let el = v
      gv.playerChilds = []
      gv.playerChilds.push(v)
      while (el && (el = el.parentNode)) {
        if (Math.abs(v.offsetWidth - el.offsetWidth) < 15 && Math.abs(v.offsetHeight - el.offsetHeight) < 15) {
          tempPlayer = el
          gv.playerChilds.push(el)
        } else {
          break
        }
      }
      return tempPlayer
    },
    leavePlayer() {
      if (gv.alwaysShow) return
      handle.hideButtons()
    },
    hideButtons() {
      if (!gv.controlBtn || gv.controlBtn.style.visibility != "visible") return
      gv.controlBtn.style.opacity = ""
      gv.controlBtn.style.visibility = ""
      gv.picinpicBtn.style.opacity = ""
      gv.picinpicBtn.style.visibility = ""
      gv.speedBtn.style.opacity = ""
      gv.speedBtn.style.visibility = ""
      if (gv.player) gv.player.removeEventListener("mouseleave", handle.leavePlayer, false)
      document.removeEventListener("scroll", handle.scrollFix, false)
    },
    scrollFix() {
      clearTimeout(gv.scrollFixTimer)
      gv.scrollFixTimer = setTimeout(() => {
        try {
          setButton.locate()
        } catch (e) {}
      }, 20)
    },
    isEditable() {
      const el = document.activeElement
      if (!el) return false
      const tag = (el.tagName || "").toUpperCase()
      return tag == "INPUT" || tag == "TEXTAREA" || tag == "SELECT" || el.isContentEditable === true
    },
    hotKey(e) {
      const key = e.keyCode || e.which
      //默认退出键为ESC
      if (key == 27) {
        maximize.playerControl()
        return
      }
      if (handle.isEditable()) return
      //默认画中画快捷键为F2
      if (key == 113) {
        handle.pictureInPicture()
        return
      }
      //F3 或 "=" 加速
      if (key == 114 || key == 187) {
        e.preventDefault()
        const i = Math.max(0, gv.speedList.indexOf(gv.speedRate))
        handle.setSpeed(gv.speedList[(i + 1) % gv.speedList.length], true)
        return
      }
      //F4 或 "-" 减速
      if (key == 115 || key == 189) {
        e.preventDefault()
        const i = Math.max(0, gv.speedList.indexOf(gv.speedRate))
        handle.setSpeed(gv.speedList[(i - 1 + gv.speedList.length) % gv.speedList.length], true)
        return
      }
      //R 重置倍速为 1x
      if (key == 82) {
        e.preventDefault()
        handle.setSpeed(1, true)
        return
      }
    },
    getVideo() {
      if (!gv.player) return null
      try {
        const p = gv.player
        if (p.nodeName == "VIDEO") return p
        if (typeof p.querySelector == "function") {
          const v = p.querySelector("video")
          if (v) return v
        }
        if (p.contentDocument && typeof p.contentDocument.querySelector == "function") {
          const v = p.contentDocument.querySelector("video")
          if (v) return v
        }
      } catch (e) {}
      return null
    },
    setSpeed(rate, showTip) {
      rate = Math.max(0.25, Math.min(16, rate))
      gv.speedRate = rate
      const v = handle.getVideo()
      if (v) {
        try {
          v.defaultPlaybackRate = rate
        } catch (e) {}
        try {
          v.playbackRate = rate
        } catch (e) {}
      }
      if (gv.speedBtn) tool.setHTML(gv.speedBtn, rate + "x")
      if (showTip) tool.addTip("倍速 " + rate + "x")
    },
    async receiveMessage(e) {
      const data = e && e.data
      if (typeof data !== "string") return
      try {
        switch (data) {
          case "iframePicInPic":
            tool.print("messege:iframePicInPic")
            if (!document.pictureInPictureElement) {
              const v = handle.getVideo()
              if (v) {
                await v
                  .requestPictureInPicture()
                  .catch((error) => {
                    tool.addTip(gv.btnText.tip)
                  })
              }
            } else {
              await document.exitPictureInPicture()
            }
            break
          case "iframeVideo":
            tool.print("messege:iframeVideo")
            if (!gv.isFull) {
              gv.player = gv.mouseoverEl
              setButton.init()
            }
            break
          case "parentFull":
            tool.print("messege:parentFull")
            gv.player = gv.mouseoverEl
            if (gv.isIframe) {
              window.parent.postMessage("parentFull", "*")
            }
            maximize.checkParent()
            maximize.fullWin()
            if (gv.player && getComputedStyle(gv.player).left != "0px") {
              tool.addStyle("#htmlToothbrush #bodyToothbrush .playerToothbrush {left:0px !important;width:100vw !important;}")
            }
            gv.isFull = true
            break
          case "parentSmall":
            tool.print("messege:parentSmall")
            if (gv.isIframe) {
              window.parent.postMessage("parentSmall", "*")
            }
            maximize.smallWin()
            break
          case "innerFull":
            tool.print("messege:innerFull")
            if (gv.player && gv.player.nodeName == "IFRAME") {
              gv.player.contentWindow.postMessage("innerFull", "*")
            }
            maximize.checkParent()
            maximize.fullWin()
            break
          case "innerSmall":
            tool.print("messege:innerSmall")
            if (gv.player && gv.player.nodeName == "IFRAME") {
              gv.player.contentWindow.postMessage("innerSmall", "*")
            }
            maximize.smallWin()
            break
        }
      } catch (e) {
        tool.print("receiveMessage: " + (e && e.message))
      }
    },
    pictureInPicture() {
      if (!document.pictureInPictureElement) {
        if (gv.player) {
          if (gv.player.nodeName == "IFRAME") {
            gv.player.contentWindow.postMessage("iframePicInPic", "*")
          } else {
            const v = handle.getVideo()
            if (v) v.requestPictureInPicture()
          }
        } else {
          const v = document.querySelector("video")
          if (v) v.requestPictureInPicture()
        }
      } else {
        document.exitPictureInPicture()
      }
    },
  }

  const maximize = {
    playerControl() {
      if (!gv.player) return
      try {
        this.checkParent()
        if (!gv.isFull) {
          if (gv.isIframe) {
            window.parent.postMessage("parentFull", "*")
          }
          if (gv.player.nodeName == "IFRAME") {
            gv.player.contentWindow.postMessage("innerFull", "*")
          }
          this.fullWin()
          if (gv.autoCheckCount > 0 && !tool.isHalfFullClient(gv.playerChilds[0])) {
            if (gv.autoCheckCount > 10) {
              for (let i = 0; i < gv.playerChilds.length; i++) {
                const cl = gv.playerChilds[i].classList
                if (cl && cl.add) cl.add("videoToothbrush")
              }
              return
            }
            const tempPlayer = handle.autoCheck(gv.playerChilds[0])
            gv.autoCheckCount++
            maximize.playerControl()
            gv.player = tempPlayer
            maximize.playerControl()
          } else {
            gv.autoCheckCount = 0
          }
        } else {
          if (gv.isIframe) {
            window.parent.postMessage("parentSmall", "*")
          }
          if (gv.player.nodeName == "IFRAME") {
            gv.player.contentWindow.postMessage("innerSmall", "*")
          }
          this.smallWin()
        }
      } catch (e) {
        tool.print("playerControl: " + (e && e.message))
      }
    },
    checkParent() {
      if (gv.isFull) return
      gv.playerParents = []
      let full = gv.player
      while (full && (full = full.parentNode)) {
        if (full.nodeName == "BODY") {
          break
        }
        if (full.getAttribute) {
          gv.playerParents.push(full)
        }
      }
    },
    fullWin() {
      if (!gv.isFull) {
        document.removeEventListener("mouseover", handle.getPlayer, false)
        gv.backHtmlId = document.body.parentNode.id
        gv.backBodyId = document.body.id
        if (tool.isYoutube() && !document.querySelector("#player-theater-container #movie_player")) {
          // v12.6 改进：比较视频容器与控制条宽度，仅非 theater 时才切换
          const container = document.querySelector(".html5-video-container")
          const bottom = document.querySelector(".ytp-chrome-bottom")
          let shouldClick = true
          if (container && bottom && container.clientWidth - bottom.clientWidth <= 24) {
            shouldClick = false
          }
          if (shouldClick) {
            const sizeBtn =
              document.querySelector("#movie_player .ytp-size-button") || document.querySelector("#ytd-player .ytp-size-button")
            if (sizeBtn) {
              sizeBtn.click()
              gv.ytbStageChange = true
            }
          }
        }
        // 为 B 站做特殊处理：全屏时隐藏顶栏与右侧栏（v12.6 改进）
        if (tool.isBilibili()) {
          const right = document.querySelector(".right-container")
          if (right) right.style.display = "none"
          const header = document.querySelector("#biliMainHeader")
          if (header) header.style.display = "none"
        }
        gv.leftBtn.style.display = "block"
        gv.rightBtn.style.display = "block"
        gv.picinpicBtn.style.display = ""
        gv.controlBtn.style.display = ""
        gv.speedBtn.style.display = ""
        this.addClass()
      }
      gv.isFull = true
      try {
        setButton.locate()
      } catch (e) {}
    },
    addClass() {
      document.body.parentNode.id = "htmlToothbrush"
      document.body.id = "bodyToothbrush"
      for (let i = 0; i < gv.playerParents.length; i++) {
        const v = gv.playerParents[i]
        if (!v || !v.classList) continue
        if (v.classList.add) v.classList.add("parentToothbrush")
        try {
          if (getComputedStyle(v).position == "fixed") {
            if (v.classList.add) v.classList.add("absoluteToothbrush")
          }
        } catch (e) {}
      }
      if (gv.player && gv.player.classList && gv.player.classList.add) {
        gv.player.classList.add("playerToothbrush")
      }
      if (gv.player && gv.player.nodeName == "VIDEO") {
        gv.backControls = gv.player.controls
        gv.player.controls = true
      }
      window.dispatchEvent(new Event("resize"))
    },
    smallWin() {
      document.body.parentNode.id = gv.backHtmlId
      document.body.id = gv.backBodyId
      for (let i = 0; i < gv.playerParents.length; i++) {
        const v = gv.playerParents[i]
        if (!v || !v.classList) continue
        if (v.classList.remove) {
          v.classList.remove("parentToothbrush")
          v.classList.remove("absoluteToothbrush")
        }
      }
      if (gv.player && gv.player.classList && gv.player.classList.remove) {
        gv.player.classList.remove("playerToothbrush")
      }
      if (tool.isYoutube() && gv.ytbStageChange && document.querySelector("#player-theater-container #movie_player")) {
        const sizeBtn =
          document.querySelector("#movie_player .ytp-size-button") || document.querySelector("#ytd-player .ytp-size-button")
        if (sizeBtn) {
          sizeBtn.click()
        }
        gv.ytbStageChange = false
      }
      // 恢复 B 站顶栏与右侧栏（v12.6 改进）
      if (tool.isBilibili()) {
        const right = document.querySelector(".right-container")
        if (right) right.style.removeProperty("display")
        const header = document.querySelector("#biliMainHeader")
        if (header) header.style.removeProperty("display")
      }
      if (gv.player && gv.player.nodeName == "VIDEO") {
        gv.player.controls = gv.backControls
      }
      gv.leftBtn.style.display = ""
      gv.rightBtn.style.display = ""
      gv.controlBtn.style.display = ""
      gv.picinpicBtn.style.display = ""
      gv.speedBtn.style.display = ""
      document.addEventListener("mouseover", handle.getPlayer, false)
      window.dispatchEvent(new Event("resize"))
      gv.isFull = false
      try {
        setButton.locate()
      } catch (e) {}
    },
  }

  const init = () => {
    try {
      // 初始化 Trusted Types 策略（只创建一次，修复 v12.6 中每次 locate 重复创建同名 policy 报错的问题）
      try {
        if (window.trustedTypes && window.trustedTypes.createPolicy) {
          try {
            gv.trustedHTML = window.trustedTypes.createPolicy("maximizeVideoPolicy", { createHTML: (s) => s })
          } catch (e) {
            gv.trustedHTML = window.trustedTypes.getPolicy("maximizeVideoPolicy") || { createHTML: (s) => s }
          }
        }
      } catch (e) {
        gv.trustedHTML = null
      }
      gv.picinpicBtn = document.createElement("div")
      gv.picinpicBtn.id = "picinpicBtn"
      gv.picinpicBtn.onclick = () => {
        handle.pictureInPicture()
      }
      if (document.body) document.body.appendChild(gv.picinpicBtn)

      gv.controlBtn = tool.createButton("playerControlBtn")
      gv.leftBtn = tool.createButton("leftFullStackButton")
      gv.rightBtn = tool.createButton("rightFullStackButton")

      gv.speedBtn = document.createElement("div")
      gv.speedBtn.id = "speedBtn"
      tool.setHTML(gv.speedBtn, "1x")
      gv.speedBtn.onclick = () => {
        const i = Math.max(0, gv.speedList.indexOf(gv.speedRate))
        handle.setSpeed(gv.speedList[(i + 1) % gv.speedList.length], true)
      }
      if (document.body) document.body.appendChild(gv.speedBtn)

      if (getComputedStyle(gv.controlBtn).position != "fixed") {
        tool.addStyle(
          [
            "#htmlToothbrush #bodyToothbrush .parentToothbrush .bilibili-player-video {margin:0 !important;}",
            "#htmlToothbrush, #bodyToothbrush {overflow:hidden !important;zoom:100% !important;}",
            "#htmlToothbrush #bodyToothbrush .parentToothbrush {overflow:visible !important;z-index:99999 !important;transform:none !important;-webkit-transform-style:flat !important;transition:none !important;contain:none !important;}",
            "#htmlToothbrush #bodyToothbrush .absoluteToothbrush {position:absolute !important;}",
            "#htmlToothbrush #bodyToothbrush .playerToothbrush {position:fixed !important;top:0px !important;left:0px !important;width:100vw !important;height:100vh !important;max-width:none !important;max-height:none !important;min-width:0 !important;min-height:0 !important;margin:0 !important;padding:0 !important;z-index:2147483646 !important;border:none !important;background-color:#000 !important;transform:none !important;}",
            "#htmlToothbrush #bodyToothbrush .parentToothbrush video {object-fit:contain !important;}",
            "#htmlToothbrush #bodyToothbrush .parentToothbrush .videoToothbrush {width:100vw !important;height:100vh !important;}",
            '#playerControlBtn {text-shadow:none;visibility:hidden;opacity:0;display:none;transition:all 0.5s ease;cursor:pointer;font:12px "微软雅黑";margin:0;width:64px;height:20px;line-height:20px;border:none;text-align:center;position:fixed;z-index:2147483647;background-color:#27A9D8;color:#FFF;user-select:none;} #playerControlBtn:hover {visibility:visible;opacity:1;background-color:#2774D8;}',
            '#picinpicBtn {text-shadow:none;visibility:hidden;opacity:0;display:none;transition:all 0.5s ease;cursor:pointer;font:12px "微软雅黑";margin:0;width:53px;height:20px;line-height:20px;border:none;text-align:center;position:fixed;z-index:2147483647;background-color:#27A9D8;color:#FFF;user-select:none;} #picinpicBtn:hover {visibility:visible;opacity:1;background-color:#2774D8;}',
            '#speedBtn {text-shadow:none;visibility:hidden;opacity:0;display:none;transition:all 0.5s ease;cursor:pointer;font:12px "微软雅黑";margin:0;width:50px;height:20px;line-height:20px;border:none;text-align:center;position:fixed;z-index:2147483647;background-color:#27A9D8;color:#FFF;user-select:none;} #speedBtn:hover {visibility:visible;opacity:1;background-color:#2774D8;}',
            "#leftFullStackButton{display:none;position:fixed;width:1px;height:100vh;top:0;left:0;z-index:2147483647;background:#000;}",
            "#rightFullStackButton{display:none;position:fixed;width:1px;height:100vh;top:0;right:0;z-index:2147483647;background:#000;}",
            "#catTip{pointer-events:none;user-select:none;}",
          ].join("\n")
        )
      }
      document.addEventListener("mouseover", handle.getPlayer, false)
      document.addEventListener("keydown", handle.hotKey, false)
      window.addEventListener("message", handle.receiveMessage, false)
      // YouTube 播放器采用独立检测：按钮常驻显示在播放器上，不依赖鼠标悬停
      // （YouTube 2025 新 UI 控件进入 shadow DOM，悬停检测可能失效）
      if (tool.isYoutube()) {
        gv.alwaysShow = true
        gv.autoScanTimer = setInterval(() => {
          try {
            if (gv.isFull) return
            const mp =
              document.querySelector("#movie_player") ||
              document.querySelector("#ytd-player") ||
              document.querySelector(".html5-video-player")
            if (!mp) return
            gv.player = mp
            const rect = mp.getBoundingClientRect()
            const vh = window.innerHeight || document.documentElement.clientHeight || 0
            const inView = rect.bottom > 0 && rect.top < vh
            if (inView) {
              setButton.init()
            } else {
              handle.hideButtons()
            }
          } catch (e) {}
        }, 2000)
      }
      tool.print("Ready")
    } catch (e) {
      tool.print("init error: " + (e && e.message))
    }
  }

  init()
})()
