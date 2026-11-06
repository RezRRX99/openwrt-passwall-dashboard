package com.routerdash;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.RouteInfo;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.util.UUID;

/**
 * Shows the router's dashboard full screen.
 *
 * Chrome installs a web app only from trusted HTTPS, which a private router cannot have unless
 * each phone trusts a certificate. This app needs neither, and the page itself still comes from
 * the router, so dashboard updates never need a new app.
 *
 * The router is the Wi-Fi network's gateway, so there is nothing to set up. Anyone whose
 * dashboard lives elsewhere can type another address on the "not found" page.
 */
public class MainActivity extends Activity {
    private static final String FALLBACK_ADDRESS = "192.168.1.1";
    private static final String KEY_ADDRESS = "address";
    private static final String RETRY = "routerdash://retry";
    // Off the router's network a connection can hang for minutes without any error.
    private static final long LOAD_LIMIT_MS = 12000;

    private WebView web;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback wifiCallback;
    private SharedPreferences prefs;
    private final Handler timer = new Handler(Looper.getMainLooper());
    private final Runnable giveUp = this::showOffline;
    private String address;
    private String retryToken;
    private boolean offline;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = getPreferences(MODE_PRIVATE);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#07060C"));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        // The app opens whatever gateway the phone joins. Without this, a hostile network with the
        // same address could leave a cached script that later runs against the real router.
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setUserAgentString(settings.getUserAgentString() + " RouterDashApp/1");
        web.setWebViewClient(new Client());
        setContentView(web);
        connectivity = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        useWifi();
        loadHome();
    }

    private String wifiGateway() {
        for (Network network : connectivity.getAllNetworks()) {
            NetworkCapabilities caps = connectivity.getNetworkCapabilities(network);
            LinkProperties link = connectivity.getLinkProperties(network);
            if (caps == null || link == null || !caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) continue;
            for (RouteInfo route : link.getRoutes()) {
                InetAddress gateway = route.getGateway();
                if (route.isDefaultRoute() && gateway instanceof Inet4Address && !gateway.isAnyLocalAddress()) {
                    return gateway.getHostAddress();
                }
            }
        }
        return FALLBACK_ADDRESS;
    }

    private void loadHome() {
        address = prefs.getString(KEY_ADDRESS, null);
        if (address == null) address = wifiGateway();
        offline = false;
        timer.removeCallbacks(giveUp);
        timer.postDelayed(giveUp, LOAD_LIMIT_MS);
        web.loadUrl("http://" + address + "/dash/");
    }

    private void showOffline() {
        timer.removeCallbacks(giveUp);
        offline = true;
        retryToken = UUID.randomUUID().toString();
        web.stopLoading();
        web.loadDataWithBaseURL(null, offlinePage(), "text/html", "utf-8", null);
    }

    // Only an address that passed validAddress or came from the system reaches this page.
    private String offlinePage() {
        return "<!doctype html><meta charset=utf-8>"
            + "<meta name=viewport content='width=device-width,initial-scale=1'>"
            + "<style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;"
            + "justify-content:center;gap:12px;padding:24px;box-sizing:border-box;background:#07060C;"
            + "color:#F3F1FA;font:16px/1.6 sans-serif;text-align:center}p{margin:0}"
            + "input{width:220px;margin-top:12px;padding:12px;border-radius:12px;border:1px solid #6B6480;"
            + "background:#17132A;color:#F3F1FA;font:16px sans-serif;text-align:center}"
            + "button{padding:12px 28px;border:0;border-radius:999px;background:#9B5CFF;color:#14091F;"
            + "font:600 16px sans-serif}</style>"
            + "<p dir=rtl>روتر پیدا نشد. به Wi-Fi روتر وصل شوید یا آدرس آن را بنویسید.</p>"
            + "<p>Router not found. Join its Wi-Fi or type its address.</p>"
            + "<input id=a dir=ltr inputmode=url autocapitalize=off value='" + address + "'>"
            + "<button onclick=\"location.href='" + RETRY + "?token=" + retryToken + "&address='+encodeURIComponent(document.getElementById('a').value)\">"
            + "تلاش دوباره / Retry</button>";
    }

    private static boolean validAddress(String text) {
        return text != null && text.matches("[A-Za-z0-9.\\-]{1,253}(:[0-9]{1,5})?");
    }

    private void retryWith(String typed) {
        if (validAddress(typed) && !typed.equals(wifiGateway())) {
            prefs.edit().putString(KEY_ADDRESS, typed).apply();
        } else {
            prefs.edit().remove(KEY_ADDRESS).apply();
        }
        loadHome();
    }

    /**
     * When the proxy is down the Wi-Fi has no internet and Android moves apps to mobile data,
     * which cannot reach the router. That is exactly when the dashboard is needed, so this app
     * stays on Wi-Fi. A VPN on the phone is skipped the same way.
     */
    private void useWifi() {
        NetworkRequest wifi = new NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .build();
        wifiCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                connectivity.bindProcessToNetwork(network);
                runOnUiThread(() -> {
                    if (offline) loadHome();
                });
            }

            @Override
            public void onLost(Network network) {
                connectivity.bindProcessToNetwork(null);
            }
        };
        connectivity.requestNetwork(wifi, wifiCallback);
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri target = request.getUrl();
            // Only this app's own page knows the token, so a page from the network cannot
            // redirect the app to another address for good.
            if (target.toString().startsWith(RETRY)) {
                if (retryToken != null && retryToken.equals(target.getQueryParameter("token"))) {
                    retryWith(target.getQueryParameter("address"));
                }
                return true;
            }
            // The dashboard has no outside links, so nothing else may open.
            return !address.split(":")[0].equals(target.getHost());
        }

        // The router has answered, so a slow phone gets all the time it needs to draw the page.
        @Override
        public void onPageCommitVisible(WebView view, String url) {
            if (!offline) timer.removeCallbacks(giveUp);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showOffline();
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        timer.removeCallbacks(giveUp);
        connectivity.unregisterNetworkCallback(wifiCallback);
        web.destroy();
        super.onDestroy();
    }
}
