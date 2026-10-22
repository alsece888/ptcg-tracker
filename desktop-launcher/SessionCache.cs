using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace MaloTCG
{
    public sealed class RememberedSession
    {
        public string userId { get; set; }
        public string token { get; set; }
    }

    public sealed class SessionCache
    {
        readonly string path;
        readonly JavaScriptSerializer json = new JavaScriptSerializer();
        static readonly byte[] Entropy = Encoding.UTF8.GetBytes("MaloTCG.Desktop.Session.v1");

        public SessionCache(string path) { this.path = path; }

        static bool Valid(RememberedSession session)
        {
            if (session == null || session.userId == null || session.token == null || session.token.Length > 2048) return false;
            if (!Regex.IsMatch(session.userId, "^[a-z0-9][a-z0-9_-]{2,31}$")) return false;
            var parts = session.token.Split('.');
            long expires;
            if (parts.Length != 4 || parts[0] != session.userId || !long.TryParse(parts[1], out expires)) return false;
            if (!Regex.IsMatch(parts[2], "^[A-Za-z0-9_-]+$") || !Regex.IsMatch(parts[3], "^[A-Za-z0-9_-]+$")) return false;
            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            return expires > now && expires <= now + 48 * 60 * 60 + 60;
        }

        public bool Clear()
        {
            try { if (File.Exists(path)) File.Delete(path); return true; }
            catch { return false; }
        }

        public bool Save(string value)
        {
            try {
                var session = json.Deserialize<RememberedSession>(value ?? "null");
                if (!Valid(session)) return Clear();
                // Persist only the validated user ID and bearer token, never password fields.
                var encrypted = ProtectedData.Protect(Encoding.UTF8.GetBytes(json.Serialize(session)), Entropy, DataProtectionScope.CurrentUser);
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                var temp = path + ".tmp";
                File.WriteAllBytes(temp, encrypted);
                if (File.Exists(path)) File.Replace(temp, path, null);
                else File.Move(temp, path);
                return true;
            } catch { return false; }
        }

        public RememberedSession Read()
        {
            try {
                if (!File.Exists(path)) return null;
                var encrypted = File.ReadAllBytes(path);
                var value = Encoding.UTF8.GetString(ProtectedData.Unprotect(encrypted, Entropy, DataProtectionScope.CurrentUser));
                var session = json.Deserialize<RememberedSession>(value);
                if (Valid(session)) return session;
            } catch { /* Corrupt, expired, or protected by another Windows account. */ }
            Clear();
            return null;
        }

        public string RestoreScript()
        {
            var session = Read();
            if (session == null) return null;
            return "(()=>{if(window.top!==window||location.origin!=='https://malo-ptcg.cn')return;const s=" + json.Serialize(session) + ";const bound=localStorage.getItem('ptcg-cloud-user-id');if((!bound||bound===s.userId)&&Number(s.token.split('.')[1])*1000>Date.now()&&!sessionStorage.getItem('ptcg-cloud-session'))sessionStorage.setItem('ptcg-cloud-session',JSON.stringify(s));})();";
        }
    }
}
