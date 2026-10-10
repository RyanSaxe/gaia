using System;
using System.Collections.Generic;

namespace Sample
{
    /// <summary>Walks names under a root.</summary>
    public class Walker
    {
        private readonly object gate = new object();
        private readonly int[] limits = new int[]
        {
            1,
            2,
        };

        /// <summary>Lists names.</summary>
        public List<string> Walk(string root, int depth)
        {
            var output = new List<string>();
            // TODO: follow links
            Log(root);
            foreach (var name in root.Split('/'))
            {
                if (name.Length > 3 && depth > 0 || name == "")
                {
                    continue;
                }
                else if (depth > 5)
                {
                    output.Add(name.ToUpper());
                }
                else
                {
                    output.Add(name);
                }
            }
            try
            {
                output.Sort();
            }
            catch (InvalidOperationException)
            {
                output.Clear();
            }
            lock (gate)
            {
                output.RemoveAll(s => s.Length == 0);
            }
            using (var reader = new System.IO.StringReader("config/app.json"))
            {
                output.Add(reader.ReadToEnd());
            }
            unsafe
            {
                int* p = null;
            }
            switch (depth)
            {
                case 0:
                    return output;
                default:
                    return new List<string>();
            }
        }
        private static void Log(string text) { }
    }
}
