using System;
using System.Diagnostics;
using System.IO;

class Program {
    static void Main(string[] args) {
        if (args.Length >= 2 && args[0] == "-c") {
            string cmd = args[1];
            // 若傳入命令以雙引號開頭，加上外層雙引號包裹，
            // 避免 cmd.exe /c 遇到多組雙引號時剝除最外層引號導致路徑損毀。
            if (cmd.StartsWith("\"") && !cmd.StartsWith("\"\"")) {
                cmd = "\"" + cmd + "\"";
            }
            ProcessStartInfo psi = new ProcessStartInfo {
                FileName = "cmd.exe",
                Arguments = "/c " + cmd,
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true
            };
            using (Process p = Process.Start(psi)) {
                using (Stream stream = p.StandardOutput.BaseStream)
                using (Stream stdout = Console.OpenStandardOutput()) {
                    stream.CopyTo(stdout);
                }
                p.WaitForExit();
            }
        }
    }
}
