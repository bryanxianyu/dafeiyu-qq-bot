// 大肥鱼安装程序：内嵌 payload.zip，图形向导，支持覆盖升级（保留数据与 QQ 登录）
// 编译：csc /target:winexe /win32icon:fish.ico /resource:payload.zip,payload.zip /r:System.Windows.Forms.dll /r:System.Drawing.dll
//       /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll setup.cs
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Setup
{
    public const string Version = "__VERSION__";
    const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\dafeiyu";
    static bool NoRegistry;

    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    [STAThread]
    static void Main()
    {
        // 静默安装：大肥鱼-Setup.exe /silent [/dir=D:\dafeiyu] [/noshortcuts] [/noregistry] [/launch]
        var args = Environment.GetCommandLineArgs().Skip(1).Select(a => a.Trim()).ToList();
        if (args.Any(a => a.Equals("/silent", StringComparison.OrdinalIgnoreCase)))
        {
            var dirArg = args.FirstOrDefault(a => a.StartsWith("/dir=", StringComparison.OrdinalIgnoreCase));
            var dir = dirArg != null ? dirArg.Substring(5).Trim('"') : DefaultDir();
            var err = CheckPath(dir);
            if (err != null) { Console.Error.WriteLine(err); Environment.Exit(2); }
            var noShortcuts = args.Contains("/noshortcuts", StringComparer.OrdinalIgnoreCase);
            NoRegistry = args.Contains("/noregistry", StringComparer.OrdinalIgnoreCase);
            try { Install(dir, !noShortcuts, !noShortcuts, (p, msg) => { }); }
            catch (Exception ex)
            {
                File.WriteAllText(Path.Combine(Path.GetTempPath(), "dafeiyu-setup.log"), ex.ToString());
                Environment.Exit(1);
            }
            if (args.Contains("/launch", StringComparer.OrdinalIgnoreCase)) Process.Start(Path.Combine(dir.TrimEnd('\\'), "大肥鱼.exe"));
            return;
        }
        try { SetProcessDPIAware(); } catch { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SetupForm());
    }

    public static string ExistingInstall()
    {
        using (var k = Registry.CurrentUser.OpenSubKey(UninstallKey))
        {
            var loc = k == null ? null : k.GetValue("InstallLocation") as string;
            return loc != null && File.Exists(Path.Combine(loc, "大肥鱼.exe")) ? loc : null;
        }
    }

    public static string DefaultDir()
    {
        var existing = ExistingInstall();
        if (existing != null) return existing;
        foreach (var d in DriveInfo.GetDrives())
            if (d.Name.StartsWith("D", StringComparison.OrdinalIgnoreCase) && d.DriveType == DriveType.Fixed && d.IsReady) return @"D:\dafeiyu";
        return @"C:\dafeiyu";
    }

    /// <summary>NapCat 在中文/空格路径下会启动失败</summary>
    public static string CheckPath(string dir)
    {
        if (string.IsNullOrWhiteSpace(dir) || !Path.IsPathRooted(dir)) return "请选择一个完整路径，例如 D:\\dafeiyu";
        if (Regex.IsMatch(dir, @"[^\x21-\x7E]")) return "路径里不能有中文或空格（QQ 组件不支持），例如 D:\\dafeiyu";
        if (dir.TrimEnd('\\').Length <= 3) return "不要直接装在磁盘根目录，例如 D:\\dafeiyu";
        // 依赖目录很深，Windows 有 260 字符的路径上限（包内最深的相对路径约 140 字符）
        if (dir.TrimEnd('\\').Length > 80) return "路径太长了，请选短一点的位置，例如 D:\\dafeiyu";
        return null;
    }

    public static void Install(string dir, bool desktop, bool startMenu, Action<int, string> progress)
    {
        dir = dir.TrimEnd('\\');
        progress(2, "正在关闭正在运行的大肥鱼……");
        KillInstalled(dir);
        Directory.CreateDirectory(dir);

        progress(5, "清理旧版本程序文件……");
        // 程序文件整体替换；data（配置/记忆/会话）、home 里的会话、napcat 里已装好的 QQ 都保留
        foreach (var sub in new[] { "app", @"runtime\dsh", @"home\profiles\fish\node_modules", "scripts" })
        {
            var p = Path.Combine(dir, sub);
            if (Directory.Exists(p)) Directory.Delete(p, true);
        }
        // 早期版本的入口脚本
        foreach (var f in new[] { "启动大肥鱼.bat", "重新配置.bat" })
            try { File.Delete(Path.Combine(dir, f)); } catch { }

        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Read))
        {
            var entries = zip.Entries.Where(e => !string.IsNullOrEmpty(e.Name)).ToList();
            for (int i = 0; i < entries.Count; i++)
            {
                var e = entries[i];
                var rel = e.FullName.Replace('/', '\\');
                var target = Path.Combine(dir, rel);
                // 用户数据：已存在就不覆盖
                if (rel.StartsWith("data\\", StringComparison.OrdinalIgnoreCase) && File.Exists(target)) continue;
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                e.ExtractToFile(target, true);
                if (i % 50 == 0) progress(5 + (int)(85.0 * i / entries.Count), "正在安装：" + rel);
            }
        }

        progress(92, "创建快捷方式……");
        var exe = Path.Combine(dir, "大肥鱼.exe");
        if (desktop) Shortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "大肥鱼.lnk"), exe, "", dir);
        if (startMenu)
        {
            var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "大肥鱼");
            Directory.CreateDirectory(folder);
            Shortcut(Path.Combine(folder, "大肥鱼.lnk"), exe, "", dir);
            Shortcut(Path.Combine(folder, "卸载大肥鱼.lnk"), exe, "/uninstall", dir);
        }

        progress(96, "登记到「应用和功能」……");
        if (!NoRegistry)
        using (var k = Registry.CurrentUser.CreateSubKey(UninstallKey))
        {
            k.SetValue("DisplayName", "大肥鱼");
            k.SetValue("DisplayVersion", Version);
            k.SetValue("Publisher", "大肥鱼");
            k.SetValue("DisplayIcon", exe);
            k.SetValue("InstallLocation", dir);
            k.SetValue("UninstallString", "\"" + exe + "\" /uninstall");
            k.SetValue("NoModify", 1, RegistryValueKind.DWord);
            k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            k.SetValue("EstimatedSize", 220 * 1024, RegistryValueKind.DWord);
        }
        progress(100, "安装完成");
    }

    static void Shortcut(string lnk, string target, string args, string workDir)
    {
        var shellType = Type.GetTypeFromProgID("WScript.Shell");
        dynamic shell = Activator.CreateInstance(shellType);
        dynamic s = shell.CreateShortcut(lnk);
        s.TargetPath = target;
        s.Arguments = args;
        s.WorkingDirectory = workDir;
        s.IconLocation = target + ",0";
        s.Save();
    }

    static void KillInstalled(string dir)
    {
        var self = Process.GetCurrentProcess().Id;
        for (int round = 0; round < 2; round++)
        {
            foreach (var p in Process.GetProcesses())
            {
                try
                {
                    if (p.Id == self) continue;
                    if (p.MainModule.FileName.StartsWith(dir + "\\", StringComparison.OrdinalIgnoreCase)) { p.Kill(); p.WaitForExit(5000); }
                }
                catch { }
            }
            Thread.Sleep(500);
        }
    }
}

class SetupForm : Form
{
    TextBox dirBox = new TextBox();
    CheckBox desktop = new CheckBox(), startMenu = new CheckBox(), launch = new CheckBox();
    Button installBtn = new Button(), browseBtn = new Button();
    ProgressBar bar = new ProgressBar();
    Label status = new Label(), warn = new Label();
    bool done;

    public SetupForm()
    {
        Text = "安装大肥鱼 " + Setup.Version;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        Font = new Font("Microsoft YaHei UI", 9.5f);
        AutoScaleMode = AutoScaleMode.Dpi;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(560, 380);
        BackColor = Color.White;

        var header = new Panel { Dock = DockStyle.Top, Height = 96, BackColor = Color.FromArgb(16, 35, 63) };
        var logo = new PictureBox { Image = new Icon(Icon, 64, 64).ToBitmap(), SizeMode = PictureBoxSizeMode.CenterImage, Bounds = new Rectangle(20, 16, 64, 64) };
        var title = new Label { Text = "大肥鱼", ForeColor = Color.White, Font = new Font("Microsoft YaHei UI", 18f, FontStyle.Bold), AutoSize = true, Location = new Point(96, 18) };
        var sub = new Label { Text = "让 DeepSeek 住进你的 QQ · v" + Setup.Version, ForeColor = Color.FromArgb(160, 190, 230), AutoSize = true, Location = new Point(99, 58) };
        header.Controls.AddRange(new Control[] { logo, title, sub });
        Controls.Add(header);

        var existing = Setup.ExistingInstall();
        // 手动解压过的旧版没有注册表记录，按数据目录识别
        if (existing == null && File.Exists(Path.Combine(Setup.DefaultDir(), @"data\config.json"))) existing = Setup.DefaultDir();
        var intro = new Label
        {
            Text = existing != null
                ? "检测到已安装的大肥鱼，将覆盖升级程序文件。\n你的配置、记忆、人格卡和 QQ 登录都会保留。"
                : "内置运行环境，无需另装 Node.js / QQ。\n首次启动会自动下载 QQ 组件（约 200MB）。",
            Location = new Point(24, 112), Size = new Size(510, 44)
        };
        var dirLabel = new Label { Text = "安装位置（不能有中文和空格）", Location = new Point(24, 166), AutoSize = true };
        dirBox.Text = Setup.DefaultDir();
        dirBox.Bounds = new Rectangle(24, 190, 420, 28);
        dirBox.TextChanged += delegate { Validate(); };
        browseBtn.Text = "浏览…";
        browseBtn.Bounds = new Rectangle(452, 189, 84, 30);
        browseBtn.Click += delegate
        {
            using (var dlg = new FolderBrowserDialog { Description = "选择安装位置（会在里面建 dafeiyu 文件夹）" })
                if (dlg.ShowDialog() == DialogResult.OK) dirBox.Text = Path.Combine(dlg.SelectedPath, "dafeiyu");
        };
        warn.ForeColor = Color.FromArgb(214, 69, 69);
        warn.Bounds = new Rectangle(24, 222, 510, 22);
        desktop.Text = "创建桌面快捷方式"; desktop.Checked = true; desktop.Bounds = new Rectangle(24, 248, 200, 26);
        startMenu.Text = "添加到开始菜单"; startMenu.Checked = true; startMenu.Bounds = new Rectangle(230, 248, 200, 26);
        launch.Text = "安装完成后启动大肥鱼"; launch.Checked = true; launch.Bounds = new Rectangle(24, 276, 260, 26);
        bar.Bounds = new Rectangle(24, 312, 512, 10);
        status.Bounds = new Rectangle(24, 330, 380, 40);
        status.ForeColor = Color.Gray;
        installBtn.Text = existing != null ? "升级" : "安装";
        installBtn.Bounds = new Rectangle(416, 332, 120, 36);
        installBtn.BackColor = Color.FromArgb(47, 124, 246);
        installBtn.ForeColor = Color.White;
        installBtn.FlatStyle = FlatStyle.Flat;
        installBtn.FlatAppearance.BorderSize = 0;
        installBtn.Click += OnInstall;
        Controls.AddRange(new Control[] { intro, dirLabel, dirBox, browseBtn, warn, desktop, startMenu, launch, bar, status, installBtn });
        Validate();
    }

    new void Validate()
    {
        var err = Setup.CheckPath(dirBox.Text.Trim());
        warn.Text = err ?? "";
        installBtn.Enabled = err == null;
    }

    void OnInstall(object sender, EventArgs e)
    {
        if (done)
        {
            if (launch.Checked) Process.Start(Path.Combine(dirBox.Text.Trim().TrimEnd('\\'), "大肥鱼.exe"));
            Close();
            return;
        }
        var dir = dirBox.Text.Trim();
        foreach (Control c in Controls) if (c is TextBox || c is CheckBox || c is Button) c.Enabled = false;
        bool d = desktop.Checked, s = startMenu.Checked;
        var t = new Thread(() =>
        {
            try
            {
                Setup.Install(dir, d, s, (p, msg) => BeginInvoke((Action)(() => { bar.Value = p; status.Text = msg; })));
                BeginInvoke((Action)(() =>
                {
                    done = true;
                    status.Text = "安装完成！" + (launch.Checked ? "点「完成」启动大肥鱼。" : "");
                    status.ForeColor = Color.FromArgb(26, 163, 107);
                    installBtn.Text = "完成";
                    installBtn.Enabled = true;
                    launch.Enabled = true;
                }));
            }
            catch (Exception ex)
            {
                BeginInvoke((Action)(() =>
                {
                    status.Text = "安装失败：" + ex.Message;
                    status.ForeColor = Color.FromArgb(214, 69, 69);
                    foreach (Control c in Controls) if (c is TextBox || c is CheckBox || c is Button) c.Enabled = true;
                }));
            }
        });
        t.IsBackground = true;
        t.Start();
    }
}
