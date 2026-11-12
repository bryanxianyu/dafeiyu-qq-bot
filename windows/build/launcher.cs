// 大肥鱼.exe —— 托盘启动器（无黑窗口）+ 卸载程序（/uninstall）
// 编译：csc /target:winexe /win32icon:fish.ico /r:System.Windows.Forms.dll /r:System.Drawing.dll launcher.cs
// 语法限制在 C# 5（Windows 自带的 csc），不用字符串插值、?. 等新语法。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Launcher
{
    static string Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
    static Process server;
    static int port;
    static string adminToken = Guid.NewGuid().ToString("N");
    static NotifyIcon tray;
    static bool quitting;
    static int crashes;
    static StreamWriter consoleLog;

    [STAThread]
    static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        if (args.Length > 0 && args[0].ToLower() == "/uninstall") { Uninstall(); return; }

        bool created;
        var mutex = new Mutex(true, "dafeiyu-" + Root.ToLower().GetHashCode().ToString("x"), out created);
        if (!created)
        {
            // 已经在运行：再起一次控制台，它会发现已有实例并打开浏览器后退出
            var p = StartNode(false);
            if (p != null) p.WaitForExit(5000);
            return;
        }

        if (!File.Exists(Path.Combine(Root, @"runtime\node.exe")))
        {
            MessageBox.Show("找不到 runtime\\node.exe，安装可能不完整，请重新运行安装程序。", "大肥鱼", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        Directory.CreateDirectory(Path.Combine(Root, "data"));
        consoleLog = new StreamWriter(Path.Combine(Root, @"data\console.log"), false, Encoding.UTF8);
        consoleLog.AutoFlush = true;

        tray = new NotifyIcon();
        tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        tray.Text = "大肥鱼";
        tray.Visible = true;
        var menu = new ContextMenuStrip();
        menu.Items.Add("打开控制台", null, delegate { OpenConsole(); });
        menu.Items.Add("打开安装目录", null, delegate { Process.Start("explorer.exe", "\"" + Root + "\""); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出大肥鱼（QQ 和 AI 一起下线）", null, delegate { Quit(); });
        menu.Items.Insert(0, new ToolStripMenuItem("扫码登录 QQ", null, delegate { ShowLogin(); }));
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += delegate { OpenConsole(); };

        loginForm = new LoginForm();
        loginForm.RequestRefresh = RefreshQr;
        loginForm.OpenConsole = OpenConsole;
        loginForm.Dismissed = delegate
        {
            loginDismissed = true;
            tray.ShowBalloonTip(4000, "还没登录 QQ", "需要时右键托盘里的小鱼 →「扫码登录 QQ」。", ToolTipIcon.Info);
        };
        var forceHandle = loginForm.Handle; // 先建窗口句柄，后台线程才能 BeginInvoke
        var poller = new Thread(PollLogin);
        poller.IsBackground = true;
        poller.Start();

        server = StartNode(true);
        tray.ShowBalloonTip(3000, "大肥鱼已启动", "控制台会在浏览器里打开。之后可以从右下角托盘图标找回它。", ToolTipIcon.Info);
        Application.ApplicationExit += delegate { if (!quitting) StopServer(); };
        Application.Run();
    }

    static Process StartNode(bool main)
    {
        // 崩溃后自动重启时不再弹浏览器
        var psi = new ProcessStartInfo(Path.Combine(Root, @"runtime\node.exe"), "app\\server.mjs" + (main && crashes > 0 ? " --no-open" : ""));
        psi.WorkingDirectory = Root;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = Encoding.UTF8;
        psi.StandardErrorEncoding = Encoding.UTF8;
        psi.EnvironmentVariables["FISH_ADMIN_TOKEN"] = adminToken;
        psi.EnvironmentVariables["FISH_LAUNCHER_PID"] = Process.GetCurrentProcess().Id.ToString();
        var p = new Process();
        p.StartInfo = psi;
        if (main)
        {
            p.EnableRaisingEvents = true;
            p.OutputDataReceived += OnOutput;
            p.ErrorDataReceived += OnOutput;
            p.Exited += OnServerExit;
        }
        try { p.Start(); }
        catch (Exception e) { MessageBox.Show("启动失败：" + e.Message, "大肥鱼"); return null; }
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        return p;
    }

    static void OnOutput(object sender, DataReceivedEventArgs e)
    {
        if (e.Data == null) return;
        try { consoleLog.WriteLine(e.Data); } catch { }
        var m = Regex.Match(e.Data, @"127\.0\.0\.1:(\d+)/");
        if (m.Success && port == 0) port = int.Parse(m.Groups[1].Value);
    }

    static void OnServerExit(object sender, EventArgs e)
    {
        if (quitting) return;
        crashes++;
        if (crashes > 3)
        {
            tray.ShowBalloonTip(5000, "大肥鱼停止了", "控制台反复退出，请查看 data\\console.log。", ToolTipIcon.Error);
            return;
        }
        Thread.Sleep(3000);
        port = 0;
        server = StartNode(true);
    }

    // ---------- 扫码登录 ----------
    static LoginForm loginForm;
    static bool loginDismissed, loggedIn;
    static double shownQr;

    static WebClient Client()
    {
        var wc = new WebClient();
        wc.Encoding = Encoding.UTF8;
        wc.Headers["X-Fish-Admin"] = adminToken;
        return wc;
    }

    static void PollLogin()
    {
        var json = new System.Web.Script.Serialization.JavaScriptSerializer();
        while (!quitting)
        {
            Thread.Sleep(2000);
            if (port == 0) continue;
            try
            {
                Dictionary<string, object> s;
                using (var wc = Client()) s = json.Deserialize<Dictionary<string, object>>(wc.DownloadString("http://127.0.0.1:" + port + "/api/launcher/login"));
                if (!(s["enabled"] is bool) || !(bool)s["enabled"]) continue;
                var login = s["login"] as Dictionary<string, object>;
                var qr = Convert.ToDouble(s["qrcode"]);
                var napcat = Convert.ToString(s["napcat"]);
                var botQQ = Convert.ToString(s["botQQ"]);
                var loginError = s.ContainsKey("loginError") ? Convert.ToString(s["loginError"]) : "";
                byte[] img = null;
                if (login == null && qr > 0 && qr != shownQr)
                    using (var wc = Client()) img = wc.DownloadData("http://127.0.0.1:" + port + "/api/launcher/qrcode");
                loginForm.BeginInvoke((Action)(() => OnLoginState(login, qr, img, napcat, botQQ, loginError)));
            }
            catch { }
        }
    }

    static void OnLoginState(Dictionary<string, object> login, double qr, byte[] img, string napcat, string botQQ, string loginError)
    {
        if (login != null)
        {
            if (!loggedIn)
            {
                var who = Convert.ToString(login["nickname"]) + "（" + Convert.ToString(login["uin"]) + "）";
                if (loginForm.Visible) loginForm.Success(who);
                if (shownQr > 0) tray.ShowBalloonTip(4000, "QQ 已登录", who + " 上线了，大肥鱼开始干活。", ToolTipIcon.Info);
            }
            loggedIn = true;
            loginDismissed = false;
            shownQr = 0;
            return;
        }
        loggedIn = false;
        loginForm.SetAccount(botQQ);
        loginForm.SetError(loginError);
        if (qr > 0)
        {
            if (img != null)
            {
                loginForm.SetQr(img);
                shownQr = qr;
            }
            if (!loginForm.Visible && !loginDismissed) loginForm.ShowUp();
        }
        else if (loginForm.Visible)
            loginForm.Status(napcat == "installing" ? "正在下载 QQ 组件（约 200MB），完成后会出现二维码……" : napcat == "running" ? "正在登录 QQ，稍等几秒……" : "QQ 没在运行，点「换一张」重新启动。");
    }

    static void ShowLogin()
    {
        loginDismissed = false;
        if (loggedIn) loginForm.Success("已经登录");
        else if (shownQr == 0) loginForm.Status("正在获取二维码……");
        loginForm.ShowUp();
    }

    static void RefreshQr()
    {
        if (port == 0) return;
        shownQr = 0;
        var t = new Thread(() =>
        {
            try
            {
                using (var wc = Client())
                {
                    wc.Headers["Content-Type"] = "application/json";
                    wc.UploadString("http://127.0.0.1:" + port + "/api/launcher/refresh", "{}");
                }
            }
            catch { }
        });
        t.IsBackground = true;
        t.Start();
    }

    static void OpenConsole()
    {
        if (port > 0) Process.Start("http://127.0.0.1:" + port + "/");
        else StartNode(false);
    }

    static void StopServer()
    {
        if (server == null || server.HasExited) return;
        try
        {
            if (port > 0)
            {
                var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/shutdown");
                req.Method = "POST";
                req.Headers["X-Fish-Admin"] = adminToken;
                req.ContentLength = 0;
                req.Timeout = 5000;
                req.GetResponse().Close();
            }
        }
        catch { }
        if (!server.WaitForExit(20000)) KillTree(server.Id);
    }

    static void Quit()
    {
        quitting = true;
        tray.Text = "大肥鱼：正在下线……";
        StopServer();
        tray.Visible = false;
        Application.Exit();
    }

    static void KillTree(int pid)
    {
        try
        {
            var psi = new ProcessStartInfo("taskkill", "/PID " + pid + " /T /F");
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            Process.Start(psi).WaitForExit(5000);
        }
        catch { }
    }

    /// <summary>结束安装目录下的所有相关进程（node、NapCat、QQ、其他大肥鱼.exe）</summary>
    public static void KillInstalled(string dir)
    {
        var self = Process.GetCurrentProcess().Id;
        foreach (var p in Process.GetProcesses())
        {
            try
            {
                if (p.Id == self) continue;
                var file = p.MainModule.FileName;
                if (file.StartsWith(dir + "\\", StringComparison.OrdinalIgnoreCase)) { p.Kill(); p.WaitForExit(5000); }
            }
            catch { }
        }
    }

    static void Uninstall()
    {
        if (MessageBox.Show("确定要卸载大肥鱼吗？", "卸载大肥鱼", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        var keep = MessageBox.Show("要保留聊天记录、记忆、人格卡和 QQ 登录信息吗？\n\n选「是」：只删程序，数据留在 " + Root + "\\data，以后重装可继续使用。\n选「否」：全部删除。",
            "卸载大肥鱼", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);
        if (keep == DialogResult.Cancel) return;

        KillInstalled(Root);
        try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\dafeiyu", false); } catch { }
        try { File.Delete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "大肥鱼.lnk")); } catch { }
        try { Directory.Delete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "大肥鱼"), true); } catch { }

        // 自己正在运行，删不掉自己：交给延迟执行的 cmd
        string cmd;
        if (keep == DialogResult.Yes)
        {
            var sb = new StringBuilder("ping 127.0.0.1 -n 3 > nul");
            foreach (var d in new[] { "app", "runtime" }) sb.AppendFormat(" & rd /s /q \"{0}\\{1}\"", Root, d);
            sb.AppendFormat(" & rd /s /q \"{0}\\home\\profiles\\fish\\node_modules\"", Root);
            sb.AppendFormat(" & del /f /q \"{0}\\大肥鱼.exe\" \"{0}\\使用说明.txt\"", Root);
            cmd = sb.ToString();
        }
        else
        {
            cmd = string.Format("ping 127.0.0.1 -n 3 > nul & rd /s /q \"{0}\"", Root);
        }
        var psi = new ProcessStartInfo("cmd.exe", "/c " + cmd);
        psi.CreateNoWindow = true;
        psi.UseShellExecute = false;
        psi.WorkingDirectory = Path.GetTempPath();
        Process.Start(psi);
        MessageBox.Show(keep == DialogResult.Yes ? "已卸载。你的数据保留在 " + Root + "\\data。" : "已卸载。", "卸载大肥鱼");
    }
}

/// <summary>扫码登录窗口：二维码由 NapCat 生成，这里只负责显示</summary>
class LoginForm : Form
{
    public Action RequestRefresh, OpenConsole, Dismissed;
    QrBox qr = new QrBox();
    Label tip = new Label(), status = new Label(), error = new Label();
    Button refreshBtn = new Button(), consoleBtn = new Button();
    System.Windows.Forms.Timer closeTimer = new System.Windows.Forms.Timer();

    public LoginForm()
    {
        Text = "大肥鱼 · 扫码登录 QQ";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        Font = new Font("Microsoft YaHei UI", 10f);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(380, 470);
        BackColor = Color.White;
        ShowInTaskbar = true;

        tip.Text = "用机器人 QQ 的手机 QQ 扫码，并在手机上确认登录";
        tip.Bounds = new Rectangle(20, 16, 340, 48);
        tip.TextAlign = ContentAlignment.MiddleCenter;
        qr.Bounds = new Rectangle(60, 70, 260, 260);
        status.Bounds = new Rectangle(20, 340, 340, 48);
        status.TextAlign = ContentAlignment.MiddleCenter;
        status.ForeColor = Color.Gray;
        status.Text = "二维码大约两分钟会自动换一张";
        refreshBtn.Text = "换一张";
        refreshBtn.Bounds = new Rectangle(40, 404, 140, 40);
        refreshBtn.Click += delegate
        {
            qr.Image = null;
            Status("正在重新获取二维码（重启 QQ，约 10 秒）……");
            if (RequestRefresh != null) RequestRefresh();
        };
        consoleBtn.Text = "打开控制台";
        consoleBtn.Bounds = new Rectangle(200, 404, 140, 40);
        consoleBtn.Click += delegate { if (OpenConsole != null) OpenConsole(); };
        error.Bounds = new Rectangle(20, 392, 340, 0);
        error.ForeColor = Color.FromArgb(214, 69, 69);
        error.Visible = false;
        Controls.AddRange(new Control[] { tip, qr, status, error, refreshBtn, consoleBtn });

        closeTimer.Interval = 2500;
        closeTimer.Tick += delegate { closeTimer.Stop(); Hide(); };
    }

    public void SetAccount(string uin)
    {
        tip.Text = string.IsNullOrEmpty(uin)
            ? "用机器人 QQ 的手机 QQ 扫码，并在手机上确认登录"
            : "用 QQ " + uin + " 的手机 QQ 扫码，\n并在手机上确认登录";
    }

    public void SetQr(byte[] png)
    {
        try { qr.Image = Image.FromStream(new MemoryStream(png)); } catch { }
        qr.Visible = true;
        Status("扫码后在手机上点「登录」。二维码大约两分钟会自动换一张");
    }

    /// <summary>扫码后被腾讯拒绝（风控、冻结）时显示原因，窗口加高放下这段文字</summary>
    public void SetError(string text)
    {
        if ((error.Text ?? "") == (text ?? "")) return;
        error.Text = string.IsNullOrEmpty(text) ? "" : "扫码后被腾讯拒绝登录：" + text + "\n请确认扫码的手机 QQ 登录的正是上面这个号；若提示安全风险/受限，先用这个号登录最新版手机 QQ 按提示解除，再点「换一张」重扫。";
        var h = string.IsNullOrEmpty(text) ? 0 : 110;
        error.Visible = h > 0;
        error.Height = h;
        refreshBtn.Top = consoleBtn.Top = 404 + h;
        ClientSize = new Size(380, 470 + h);
    }

    public void Status(string text)
    {
        status.ForeColor = Color.Gray;
        status.Text = text;
    }

    public void Success(string who)
    {
        qr.Image = null;
        status.ForeColor = Color.FromArgb(26, 163, 107);
        status.Text = "登录成功："  + who;
        closeTimer.Stop();
        closeTimer.Start();
    }

    public void ShowUp()
    {
        closeTimer.Stop();
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        TopMost = true;   // 从托盘弹出时抢到前台
        Activate();
        TopMost = false;
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        // 关窗口只是隐藏；退出程序时（ApplicationExitCall）才真正关闭
        if (e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            if (Dismissed != null && status.ForeColor != Color.FromArgb(26, 163, 107)) Dismissed();
        }
        base.OnFormClosing(e);
    }
}

/// <summary>二维码放大时用最近邻插值，保持清晰好扫</summary>
class QrBox : PictureBox
{
    public QrBox() { SizeMode = PictureBoxSizeMode.Zoom; BorderStyle = BorderStyle.FixedSingle; }
    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
        e.Graphics.PixelOffsetMode = PixelOffsetMode.Half;
        base.OnPaint(e);
    }
}
