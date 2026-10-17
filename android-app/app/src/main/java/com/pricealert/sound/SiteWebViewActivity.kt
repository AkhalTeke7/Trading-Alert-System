package com.pricealert.sound

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity

class SiteWebViewActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var progress: ProgressBar
    private lateinit var titleView: TextView
    private lateinit var statusView: TextView
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private val fileChooserCode = 101

    // tabs -> site path
    private val routes = mapOf(
        "markets" to "main.html",
        "alerts" to "Alert/alert.html",
        "journal" to "journal.html",
        "news" to "news.html",
        "ai" to "ai.html"
    )

    private fun baseUrl(): String {
        val p = Prefs.prefs(this)
        val url = p.getString("server_url", "")?.trim()?.trimEnd('/') ?: ""
        return if (url.isNotEmpty()) url else "file:///android_asset/Public"
    }

    private fun isAssetMode(): Boolean {
        val url = Prefs.prefs(this).getString("server_url", "")?.trim() ?: ""
        return url.isEmpty()
    }

    private fun resolve(path: String): String {
        val base = baseUrl()
        return if (base.startsWith("file://")) "$base/$path" else "$base/$path"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_site)

        webView = findViewById(R.id.siteWebView)
        progress = findViewById(R.id.siteProgress)
        titleView = findViewById(R.id.siteTitle)
        statusView = findViewById(R.id.siteStatus)

        val initial = intent.getStringExtra("route") ?: "markets"
        val initialPath = intent.getStringExtra("path") ?: routes[initial] ?: "main.html"

        findViewById<View>(R.id.siteBackBtn).setOnClickListener {
            if (webView.canGoBack()) webView.goBack() else finish()
        }
        findViewById<View>(R.id.siteBrowserBtn).setOnClickListener {
            val u = webView.url ?: resolve(initialPath)
            try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u))); } catch (_: Exception) {
                Toast.makeText(this, "No browser", Toast.LENGTH_SHORT).show()
            }
        }

        // single entry point now — opened via "Open Website" from MainActivity

        val s = webView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.allowFileAccess = true
        s.allowContentAccess = true
        s.allowFileAccessFromFileURLs = true
        s.allowUniversalAccessFromFileURLs = true
        s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        s.mediaPlaybackRequiresUserGesture = false
        s.cacheMode = WebSettings.LOAD_DEFAULT
        s.useWideViewPort = true
        s.loadWithOverviewMode = true
        s.builtInZoomControls = true
        s.displayZoomControls = false

        // keep cookies for worker auth if any
        try { android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true) } catch (_: Exception) {}

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                // keep site inside webview, external out
                if (url.startsWith("file://") || url.contains("android_asset")) return false
                val base = Prefs.prefs(this@SiteWebViewActivity).getString("server_url", "") ?: ""
                if (base.isNotEmpty() && url.startsWith(base)) return false
                // allow tradingview, fonts, etc inside
                if (url.contains("tradingview.com") || url.contains("s3.tradingview.com")) return false
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    // internal html pages stay; anything else -> external browser if not same host
                    if (url.endsWith(".html") || url.contains("/api/") || url.contains(base.trimEnd('/'))) return false
                    return try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))); true } catch (_: Exception) { false }
                }
                return false
            }

            override fun onPageFinished(view: WebView, url: String) {
                titleView.text = view.title ?: "Price-Alert"
                statusView.text = if (isAssetMode()) "OFFLINE · ASSETS" else "ONLINE"
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    // fallback to bundled assets if online load failed
                    if (!isAssetMode() && request.url.toString().startsWith(baseUrl())) {
                        val fallback = "file:///android_asset/Public/$initialPath"
                        statusView.text = "OFFLINE → ASSETS"
                        view.loadUrl(fallback)
                    }
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progress.progress = newProgress
                progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
            }
            override fun onReceivedTitle(view: WebView, title: String) {
                titleView.text = title
            }
            // journal image picker: <input type=file accept=image/*>
            override fun onShowFileChooser(
                webView: WebView, filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = filePathCallback
                return try {
                    val intent = fileChooserParams.createIntent()
                    startActivityForResult(intent, fileChooserCode)
                    true
                } catch (_: Exception) {
                    fileChooserCallback = null
                    false
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        val startUrl = if (intent.hasExtra("url")) intent.getStringExtra("url")!! else resolve(initialPath)
        statusView.text = if (isAssetMode()) "OFFLINE · ASSETS" else "LOADING…"
        webView.loadUrl(startUrl)
    }

    private fun loadRoute(key: String) {
        val path = routes[key] ?: "main.html"
        webView.loadUrl(resolve(path))
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == fileChooserCode) {
            val result = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            fileChooserCallback?.onReceiveValue(result)
            fileChooserCallback = null
        }
    }

    override fun onDestroy() {
        try { webView.destroy() } catch (_: Exception) {}
        super.onDestroy()
    }
}
