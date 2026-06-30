#!/usr/bin/env python3
import os
import sys
import re
import glob

def find_latest_session_plan():
    """Finds the most recently modified plan.md in the Copilot session state folder."""
    session_root = os.path.expanduser("~/.copilot/session-state")
    if not os.path.exists(session_root):
        return None
    
    plans = glob.glob(os.path.join(session_root, "**/plan.md"), recursive=True)
    if not plans:
        return None
        
    # Sort by modification time, newest first
    plans.sort(key=os.path.getmtime, reverse=True)
    return plans[0]

def parse_markdown(md_text):
    """Simple parser to convert markdown structure into safe HTML blocks."""
    lines = md_text.split("\n")
    html_content = []
    in_list = False
    in_code_block = False
    
    for line in lines:
        # Code block toggle
        if line.strip().startswith("```"):
            if in_code_block:
                html_content.append("</code></pre></div>")
                in_code_block = False
            else:
                lang = line.strip()[3:] or "plaintext"
                html_content.append(f"<div class='code-wrapper'><pre class='line-numbers'><code class='language-{lang}'>")
                in_code_block = True
            continue
            
        if in_code_block:
            # Escape HTML characters within code blocks
            escaped_line = line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            html_content.append(escaped_line)
            continue

        # Headings
        if line.startswith("# "):
            html_content.append(f"<h1 class='title'>{line[2:].strip()}</h1>")
        elif line.startswith("## "):
            html_content.append(f"<h2 class='section-title'>{line[3:].strip()}</h2>")
        elif line.startswith("### "):
            html_content.append(f"<h3 class='subsection-title'>{line[4:].strip()}</h3>")
            
        # Horizontal Rule
        elif line.strip() == "---":
            html_content.append("<hr class='divider' />")
            
        # List and Checklist parsing
        elif re.match(r'^\s*[\-\*]\s+', line):
            content = re.sub(r'^\s*[\-\*]\s+', '', line).strip()
            
            # Interactive Checklist
            is_checked = False
            if content.startswith("[x]") or content.startswith("[X]"):
                content = content[3:].strip()
                is_checked = True
                status_class = "done"
            elif content.startswith("[ ]"):
                content = content[3:].strip()
                status_class = "pending"
            elif "✅" in content:
                status_class = "done"
            elif "🔄" in content:
                status_class = "in-progress"
            elif "⚠️" in content:
                status_class = "warning"
            else:
                status_class = "normal"
                
            # Inline styles/links
            content = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', content)
            content = re.sub(r'\*([^*]+)\*', r'<em>\1</em>', content)
            content = re.sub(r'`([^`]+)`', r'<code class="inline-code">\1</code>', content)
            content = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2" target="_blank">\1</a>', content)
            
            checkbox_html = f"<input type='checkbox' disabled {'checked' if is_checked or status_class == 'done' else ''}>" if status_class in ["done", "pending"] else ""
            
            html_content.append(f"<li class='list-item status-{status_class}'>{checkbox_html}<span>{content}</span></li>")
            
        # Empty Line
        elif not line.strip():
            html_content.append("<br/>")
            
        # Paragraph text
        else:
            # Inline styles/links for standard paragraphs
            parsed_line = line.strip()
            if parsed_line:
                parsed_line = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', parsed_line)
                parsed_line = re.sub(r'\*([^*]+)\*', r'<em>\1</em>', parsed_line)
                parsed_line = re.sub(r'`([^`]+)`', r'<code class="inline-code">\1</code>', parsed_line)
                parsed_line = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2" target="_blank">\1</a>', parsed_line)
                html_content.append(f"<p class='paragraph'>{parsed_line}</p>")
                
    return "\n".join(html_content)

def generate_html(md_path, html_path):
    with open(md_path, "r", encoding="utf-8") as f:
        md_content = f.read()
        
    html_body = parse_markdown(md_content)
    
    # Extract Title or fall back
    title_match = re.search(r'^#\s+(.+)$', md_content, re.MULTILINE)
    title = title_match.group(1) if title_match else "Firstmate Agentic Fleet Plan"
    
    html_template = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <style>
        :root {{
            --bg-color: #0d1117;
            --container-bg: #161b22;
            --border-color: #30363d;
            --text-primary: #c9d1d9;
            --text-secondary: #8b949e;
            --accent-green: #2ea043;
            --accent-blue: #58a6ff;
            --accent-orange: #f0883e;
            --accent-red: #da3633;
            --accent-purple: #bc8cff;
            --code-bg: #090d13;
            --font-monospace: "Fira Code", Menlo, Monaco, Consolas, "Courier New", monospace;
        }}

        body {{
            background-color: var(--bg-color);
            color: var(--text-primary);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 2rem;
            display: flex;
            justify-content: center;
        }}

        .dashboard {{
            max-width: 900px;
            width: 100%;
            background-color: var(--container-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 2.5rem;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        }}

        .title {{
            font-family: var(--font-monospace);
            font-size: 2.2rem;
            color: var(--accent-blue);
            margin-top: 0;
            margin-bottom: 1.5rem;
            border-bottom: 2px solid var(--border-color);
            padding-bottom: 0.5rem;
            display: flex;
            align-items: center;
            gap: 10px;
        }}

        .title::before {{
            content: "🤖";
        }}

        .section-title {{
            font-family: var(--font-monospace);
            font-size: 1.5rem;
            color: var(--accent-purple);
            margin-top: 2rem;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            border-left: 4px solid var(--accent-purple);
            padding-left: 10px;
        }}

        .subsection-title {{
            font-family: var(--font-monospace);
            font-size: 1.15rem;
            color: var(--accent-orange);
            margin-top: 1.5rem;
            margin-bottom: 0.75rem;
        }}

        .paragraph {{
            line-height: 1.6;
            color: var(--text-primary);
            font-size: 1rem;
            margin-bottom: 1rem;
        }}

        a {{
            color: var(--accent-blue);
            text-decoration: none;
        }}

        a:hover {{
            text-decoration: underline;
        }}

        .divider {{
            border: 0;
            height: 1px;
            background: var(--border-color);
            margin: 2rem 0;
        }}

        ul {{
            list-style: none;
            padding-left: 0;
        }}

        .list-item {{
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 0.5rem 0.75rem;
            margin-bottom: 0.5rem;
            border-radius: 4px;
            border: 1px solid transparent;
            transition: all 0.2s ease;
        }}

        .list-item input[type="checkbox"] {{
            margin-top: 4px;
            cursor: pointer;
        }}

        .inline-code {{
            background-color: var(--code-bg);
            padding: 0.2rem 0.4rem;
            border-radius: 4px;
            font-family: var(--font-monospace);
            font-size: 0.9rem;
            border: 1px solid var(--border-color);
        }}

        .code-wrapper {{
            background-color: var(--code-bg);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 1rem;
            margin: 1rem 0;
            overflow-x: auto;
            font-family: var(--font-monospace);
            font-size: 0.9rem;
        }}

        pre {{
            margin: 0;
        }}

        /* Statuses styling */
        .status-done {{
            background-color: rgba(46, 160, 67, 0.1);
            border-color: rgba(46, 160, 67, 0.2);
            color: #56d364;
        }}
        
        .status-in-progress {{
            background-color: rgba(88, 166, 255, 0.1);
            border-color: rgba(88, 166, 255, 0.2);
            color: var(--accent-blue);
        }}

        .status-pending {{
            background-color: rgba(139, 148, 158, 0.05);
            border-color: var(--border-color);
            color: var(--text-secondary);
        }}

        .status-warning {{
            background-color: rgba(240, 136, 62, 0.1);
            border-color: rgba(240, 136, 62, 0.2);
            color: var(--accent-orange);
        }}

        /* Collapsible controls */
        .collapsible-header {{
            cursor: pointer;
            user-select: none;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }}

        .collapsible-header::after {{
            content: "▼";
            font-size: 0.8rem;
            transition: transform 0.2s ease;
        }}

        .collapsed .collapsible-header::after {{
            transform: rotate(-90deg);
        }}

        .collapsible-content {{
            max-height: 5000px;
            overflow: hidden;
            transition: max-height 0.3s ease;
        }}

        .collapsed .collapsible-content {{
            max-height: 0;
        }}

        /* Interactive buttons */
        .controls {{
            display: flex;
            gap: 10px;
            margin-bottom: 1.5rem;
        }}

        .btn {{
            background-color: var(--border-color);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            padding: 0.5rem 1rem;
            border-radius: 4px;
            cursor: pointer;
            font-family: var(--font-monospace);
            font-size: 0.85rem;
            transition: all 0.2s;
        }}

        .btn:hover {{
            background-color: #21262d;
            border-color: var(--text-secondary);
        }}

        .btn-active {{
            background-color: var(--accent-blue);
            border-color: var(--accent-blue);
            color: #ffffff;
        }}

        .btn-active:hover {{
            background-color: #388bfd;
        }}
    </style>
    <script>
        document.addEventListener("DOMContentLoaded", () => {{
            const sections = document.querySelectorAll(".section-title");
            sections.forEach(sec => {{
                const wrapper = document.createElement("div");
                wrapper.className = "collapsible-card";
                sec.parentNode.insertBefore(wrapper, sec);
                wrapper.appendChild(sec);
                
                let sibling = wrapper.nextSibling;
                const contentDiv = document.createElement("div");
                contentDiv.className = "collapsible-content";
                wrapper.appendChild(contentDiv);
                
                while(sibling && !sibling.classList?.contains("section-title")) {{
                    const next = sibling.nextSibling;
                    contentDiv.appendChild(sibling);
                    sibling = next;
                }}
                
                sec.className += " collapsible-header";
                sec.addEventListener("click", () => {{
                    wrapper.classList.toggle("collapsed");
                }});
            }});
        }});

        function filterStatus(status) {{
            document.querySelectorAll(".btn").forEach(b => b.classList.remove("btn-active"));
            event.target.classList.add("btn-active");
            
            const items = document.querySelectorAll(".list-item");
            items.forEach(item => {{
                if (status === 'all') {{
                    item.style.display = 'flex';
                }} else if (item.classList.contains('status-' + status)) {{
                    item.style.display = 'flex';
                }} else {{
                    item.style.display = 'none';
                }}
            }});
        }}
    </script>
</head>
<body>
    <div class="dashboard">
        <div class="controls">
            <button class="btn btn-active" onclick="filterStatus('all')">ALL</button>
            <button class="btn" onclick="filterStatus('done')">DONE</button>
            <button class="btn" onclick="filterStatus('in-progress')">IN PROGRESS</button>
            <button class="btn" onclick="filterStatus('pending')">PENDING</button>
        </div>
        {html_body}
    </div>
</body>
</html>
"""
    
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_template)
    print(f"✅ Successfully compiled Visual Plan Dashboard to: {html_path}")

if __name__ == "__main__":
    plan_path = None
    if len(sys.argv) > 1:
        plan_path = sys.argv[1]
    else:
        plan_path = find_latest_session_plan()
        
    if not plan_path or not os.path.exists(plan_path):
        print("❌ Error: No plan.md found or provided.")
        sys.exit(1)
        
    out_dir = os.path.dirname(plan_path)
    output_html_path = os.path.join(out_dir, "visual_plan.html")
    generate_html(plan_path, output_html_path)
