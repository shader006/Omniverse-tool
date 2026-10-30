import re
import os

def main():
    with open('demo/src/rn-origin.html', 'r', encoding='utf-8') as f:
        html = f.read()

    # 1. Update Title and Meta
    html = re.sub(
        r'<title.*?>.*?</title>',
        '<title>Omniverse · Learn once, process anything</title>',
        html
    )
    html = re.sub(
        r'content="React Native · Learn once, write anywhere"',
        'content="Omniverse · Learn once, process anything"',
        html
    )
    html = re.sub(
        r'content="A framework for building native apps for Android, iOS, and more using React"',
        'content="A unified multi-media and artificial intelligence platform for media downloading, Gotenberg PDF conversion, Whisper speech recognition, and AI background removal."',
        html
    )
    html = re.sub(
        r'property="og:title" content="[^"]+"',
        'property="og:title" content="Omniverse · Learn once, process anything"',
        html
    )
    html = re.sub(
        r'property="twitter:title" content="[^"]+"',
        'property="twitter:title" content="Omniverse · Learn once, process anything"',
        html
    )

    # 2. Point stylesheet directly to /src/rn-origin.css
    html = re.sub(
        r'<link rel=stylesheet href=/assets/css/styles\.[^>]+>',
        '<link rel="stylesheet" href="/src/rn-origin.css">',
        html
    )

    # 3. Remove Docusaurus warning script and unneeded telemetry
    html = re.sub(
        r'<script data-rh=true>document\.addEventListener\("DOMContentLoaded".*?</script>',
        '',
        html,
        flags=re.DOTALL
    )
    html = re.sub(
        r'<script async src="https://www\.googletagmanager\.com/gtag/js\?id=G-58L13S6BDP"></script>.*?gtag\("config","G-58L13S6BDP",\{\}\)</script>',
        '',
        html,
        flags=re.DOTALL
    )
    html = re.sub(
        r'<script src=https://widget\.surveymonkey\.com/.*?</script>',
        '',
        html
    )
    html = re.sub(
        r'<script src=/assets/js/runtime~main\.[a-z0-9]+\.js defer></script>',
        '',
        html
    )
    html = re.sub(
        r'<script src=/assets/js/main\.[a-z0-9]+\.js defer></script>',
        '',
        html
    )

    # 4. Brand & Navbar
    html = html.replace(
        '<b class="navbar__title text--truncate">React Native</b>',
        '<b class="navbar__title text--truncate">Omniverse</b>'
    )
    html = html.replace('href=/docs/getting-started>Guides</a>', 'href="#platforms">Quickstart</a>')
    html = html.replace('href=/docs/components-and-apis>Components</a>', 'href="#native">Architecture</a>')
    html = html.replace('href=/docs/accessibilityinfo>APIs</a>', 'href="#framework">Microservices</a>')
    html = html.replace('href=/architecture/overview>Architecture</a>', 'href="#ecosystem">Team & Research</a>')

    html = html.replace('href=/releases/overview>Releases</a>', 'href="#platforms">Features</a>')
    html = html.replace('href=/contributing/overview>Contributing</a>', 'href="#framework">Gotenberg</a>')
    html = html.replace('href=/community/overview>Community</a>', 'href="#framework">Whisper AI</a>')
    html = html.replace('href=/showcase>Showcase</a>', 'href="#ecosystem">Showcase</a>')
    html = html.replace('href=/blog>Blog</a>', 'href="#watch">Benchmarks</a>')

    # GitHub link
    html = html.replace('https://github.com/react/react-native', 'https://github.com/shader006/Omniverse-tool')

    # 5. Hero Section
    html = html.replace('Follow @reactnative', 'Follow @OmniverseAI')
    html = html.replace('Star react/react-native on GitHub', 'Star shader006/Omniverse-tool on GitHub')
    html = re.sub(r'<h1 class=title_[a-zA-Z0-9]+>React Native</h1>', '<h1 class="title_Z1oP">Omniverse</h1>', html)
    html = re.sub(r'<h2 class=subtitle_[a-zA-Z0-9]+>Learn once, write anywhere\.</h2>', '<h2 class="subtitle_y_z_">Learn once, process anything.</h2>', html)
    html = html.replace('href=/docs/environment-setup class=primaryButton_KqpE>Get Started</a>', 'href="#platforms" class=primaryButton_KqpE>Get Started</a>')
    html = html.replace('href=/docs/getting-started class=secondaryButton_xB1d>Learn the Basics</a>', 'href="#architecture" class=secondaryButton_xB1d>Explore Architecture</a>')

    # 6. Platforms Section (id="platforms")
    html = html.replace(
        'Create native apps for Android, iOS, and more using React',
        'All-in-one media processing and artificial intelligence'
    )
    html = html.replace(
        'React Native brings the best parts of developing with React to native development.<br/>It\'s a best-in-class JavaScript library for building user interfaces.',
        'Omniverse brings high-performance microservices and deep learning models together into a unified multimedia workflow.<br/>It\'s an enterprise-grade platform for audio, video, document, and image processing.'
    )
    html = html.replace('>index.js<', '>pipeline.ts<')

    # Code editor content
    code_old = '<span style=color:var(--home-code-red)>function</span> <span style=color:var(--home-code-purple>HomeScreen</span>()<!-- --> {<!-- --> <br/><span style=color:var(--home-code-red)>  return </span>(<!-- --> <br/>    &lt;<span style=color:var(--home-code-green)>View</span>><!-- --> <br/>      &lt;<span style=color:var(--home-code-green)>Text</span>><!-- --> Hello World 👋 🌍!<!-- -->&lt;/<span style=color:var(--home-code-green)>Text</span>><br/>    &lt;/<span style=color:var(--home-code-green)>View</span>><!-- --> <br/>  );<!-- --> <br/>}'
    code_new = '<span style=color:var(--home-code-red)>function</span> <span style=color:var(--home-code-purple>OmniversePipeline</span>()<!-- --> {<!-- --> <br/><span style=color:var(--home-code-red)>  return </span>(<!-- --> <br/>    &lt;<span style=color:var(--home-code-green)>Pipeline</span>><!-- --> <br/>      &lt;<span style=color:var(--home-code-green)>MediaDownloader</span> format=<span style=color:var(--home-code-yellow)>"mp4"</span> quality=<span style=color:var(--home-code-yellow)>"1080p"</span> /&gt;<br/>      &lt;<span style=color:var(--home-code-green)>GotenbergEngine</span> standard=<span style=color:var(--home-code-yellow)>"PDF/A-1b"</span> /&gt;<br/>      &lt;<span style=color:var(--home-code-green)>WhisperAI</span> model=<span style=color:var(--home-code-yellow)>"large-v3"</span> timestamps /&gt;<br/>    &lt;/<span style=color:var(--home-code-green)>Pipeline</span>><!-- --> <br/>  );<!-- --> <br/>}'
    html = html.replace(code_old, code_new)

    # Fox fact text
    html = html.replace(
        '<strong>Written in JavaScript, rendered with native code.</strong> React primitives render to native platform UI, meaning your app uses the same native platform APIs other apps do.',
        '<strong>Engineered in Go & Python, accelerated with native CUDA runtimes.</strong> Omniverse abstractions handle heavy media decoding, speech recognition, and document rendering with zero latency bottleneck.'
    )

    # 7. Native Section (id="native" / id="architecture")
    html = html.replace(
        'Native development for everyone',
        'High-performance media engine for everyone'
    )
    html = html.replace(
        'React Native lets you create truly native apps and doesn\'t compromise your users\' experiences. It provides a core set of platform agnostic native components like <code>View</code>,<!-- --> <code>Text</code>, and <code>Image</code> that map directly to the platform\'s native UI building blocks.',
        'Omniverse provides unified object abstractions like <code>MediaJob</code>, <code>DownloadTask</code>, <code>ConvertDocTask</code>, and <code>TranscribeTask</code> that map directly to dedicated microservices with zero performance compromise.'
    )

    # 8. Framework Section (id="framework")
    html = html.replace(
        'Get a head start with a framework',
        'Production-grade microservices architecture'
    )
    html = html.replace(
        'React Native brings the React programming paradigm to platforms like Android and iOS. It doesn’t prescribe how to do routing, or how to access each of the numerous platform APIs. To build a new app with React Native, we recommend a framework like<!-- --> <a href=https://expo.dev>Expo</a>.',
        'Omniverse decouples task scheduling from computational execution. With asynchronous message brokers, zero-loss Redis queues, and edge proxies, your media jobs run with enterprise stability.'
    )

    # Framework Cards
    html = html.replace('File-based routing', 'Gotenberg v8 Office to PDF')
    html = html.replace(
        'Create stack, modal, drawer, and tab screens with minimal boilerplate using your filesystem.',
        'Convert Word (.docx), Excel (.xlsx), PowerPoint (.pptx), and Markdown documents to standardized archive-grade PDF/A-1b files.'
    )

    html = html.replace('Use any library, SDK, or native code', 'Whisper AI Speech-to-Text')
    html = html.replace(
        'Add features from thousands of libraries and SDKs from npm or native platforms. If a feature doesn’t exist yet, you can write native code to bring it to your app.',
        'Extract crystal-clear voice subtitles with OpenAI Whisper Large-v3, complete with word timestamps and export to SRT/VTT.'
    )

    html = html.replace('Developer tools', 'AI Background Removal & Upscaling')
    html = html.replace(
        'Build, test, debug, and optimize your app with industry standard developer tools like React DevTools, Chrome DevTools, React Native DevTools, and more.',
        'Segment transparent Alpha masks using RMBG-1.4/BiRefNet and restore high-frequency image details with RealPLKSR 4x.'
    )

    # 9. Watch Section (id="watch")
    html = html.replace('Watch and learn', 'Watch and benchmark')
    html = html.replace(
        'Watch talks by the React team and learn how to get the most out of React Native.<br/>Find the latest on<!-- --> <a href=https://bsky.app/profile/reactnative.dev>Bluesky</a> and<!-- --> <a href="https://twitter.com/intent/follow?screen_name=reactnative&amp;region=follow_link">X</a>.',
        'Discover how the Omniverse architecture achieves sub-second document conversions and real-time audio transcription.<br/>Find the latest on<!-- --> <a href="https://github.com/shader006/Omniverse-tool">GitHub</a> and our research documentation.'
    )

    html = html.replace('Why React Native?', 'Why Omniverse Architecture?')
    html = html.replace('React Conf 2025<br/>React Native Keynote', 'Whisper AI Large-v3<br/>Subtitle Extraction Benchmark')
    html = html.replace('React Conf 2024<br/>React Native Keynote', 'Gotenberg v8 Engine<br/>High-Throughput PDF Rendering')
    html = html.replace('FB 2019<br/>Mobile innovation with React Native', 'Pingora Proxy & Redis<br/>Distributed Task Scheduling')

    # 10. Community Section (id="ecosystem")
    html = html.replace('Meta supported. Community driven.', 'Engineered by Group 1. Research driven.')
    html = html.replace(
        'React Native is being used in thousands of apps, but it\'s likely<br/>you\'ve already used it in one of these apps.',
        'Omniverse is designed and developed by Tong Nguyen Bao Long (ID: 23010111) and Tran Bui Nguyen Duong (ID: 23010570) as an all-in-one multimedia management platform.'
    )
    html = html.replace('See all featured apps', 'Explore Platform Showcase')
    html = html.replace(
        'Additionally, our community is always shipping exciting new projects and expanding beyond Android and iOS with initiatives like<!-- --> <a href=https://microsoft.github.io/react-native-windows/ target=_blank rel="noopener noreferrer">React Native Windows</a>,<!-- --> <a href=https://microsoft.github.io/react-native-macos/ target=_blank rel="noopener noreferrer">React Native macOS</a> <!-- -->and<!-- --> <a href=https://necolas.github.io/react-native-web/ target=_blank rel="noopener noreferrer">React Native Web</a>',
        'Additionally, our platform is actively benchmarking new AI models and expanding beyond cloud servers with edge WebAssembly inference for client-side processing.'
    )
    html = html.replace('Learn more about the Ecosystem', 'Learn more about the Architecture')

    # 11. CTA Section
    html = html.replace('Welcome to the React Native community', 'Welcome to the Omniverse ecosystem')

    # 12. Footer
    html = html.replace('Copyright © Meta Platforms, Inc.', 'Copyright © 2026 Omniverse Team (Group 1: Tong Nguyen Bao Long & Tran Bui Nguyen Duong). All rights reserved.')
    html = html.replace('<div class=footer__title>Participate</div>', '<div class=footer__title>Architecture</div>')
    html = html.replace('<div class=footer__title>Find us</div>', '<div class=footer__title>Research Team</div>')
    html = html.replace('<div class=footer__title>Explore More</div>', '<div class=footer__title>Technologies</div>')

    html = html.replace('>Guides</a>', '>Getting Started</a>')
    html = html.replace('>Components</a>', '>Microservices</a>')
    html = html.replace('>APIs</a>', '>REST & Stream APIs</a>')
    html = html.replace('>Architecture</a>', '>System Architecture</a>')

    html = html.replace('>Showcase</a>', '>Media Downloader</a>')
    html = html.replace('>Contributing</a>', '>Gotenberg PDF</a>')
    html = html.replace('>Community</a>', '>Whisper AI Subtitles</a>')
    html = html.replace('>Code of Conduct', '>RMBG Background Removal')

    html = html.replace('>Blog</a>', '>Tong Nguyen Bao Long</a>')
    html = html.replace('>X<', '>Tran Bui Nguyen Duong<')
    html = html.replace('>Bluesky<', '>Project Report<')
    html = html.replace('>GitHub<', '>GitHub Repository<')

    html = html.replace('>React<', '>Gotenberg v8 Engine<')
    html = html.replace('>Packages Directory<', '>OpenAI Whisper<')
    html = html.replace('>Privacy Policy<', '>Pingora Proxy<')
    html = html.replace('>Terms of Service<', '>Redis Task Stream<')

    # Add id attributes for smooth navigation
    html = html.replace('<div class=platformsContainer_LdgS>', '<div id="platforms" class=platformsContainer_LdgS>')
    html = html.replace('<h2 class=title_ZVnW>Native development for everyone</h2>', '<h2 id="architecture" class=title_ZVnW>Unified media processing for everyone</h2>')
    html = html.replace('<h2 class=title_ZVnW>Get a head start with a framework</h2>', '<h2 id="framework" class=title_ZVnW>Production-grade microservices architecture</h2>')
    html = html.replace('<h2 class=title_ZVnW>Watch and learn</h2>', '<h2 id="watch" class=title_ZVnW>Watch and benchmark</h2>')
    html = html.replace('<h2 class=title_ZVnW>Engineered by Group 1. Research driven.</h2>', '<h2 id="ecosystem" class=title_ZVnW>Engineered by Group 1. Research driven.</h2>')

    # Add interactive client-side JavaScript for dark/light toggle and menu
    interactive_script = """
<script>
  (function() {
    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      document.documentElement.setAttribute('data-theme-choice', theme);
      localStorage.setItem('theme', theme);
      
      var btn = document.querySelector('.colorModeToggle_Hewu button');
      if (btn) {
        btn.removeAttribute('disabled');
        btn.classList.remove('toggleButtonDisabled_Uw7m');
        btn.setAttribute('title', 'Switch between dark and light mode (currently ' + theme + ' mode)');
        btn.setAttribute('aria-label', 'Switch between dark and light mode (currently ' + theme + ' mode)');
      }
    }

    var saved = localStorage.getItem('theme') || 'dark';
    applyTheme(saved);

    document.addEventListener('DOMContentLoaded', function() {
      applyTheme(saved);

      var toggleBtn = document.querySelector('.colorModeToggle_Hewu button');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', function(e) {
          e.preventDefault();
          var current = document.documentElement.getAttribute('data-theme') || 'dark';
          var next = current === 'dark' ? 'light' : 'dark';
          applyTheme(next);
        });
      }

      // Smooth scroll navigation
      document.querySelectorAll('a[href^="#"]').forEach(function(anchor) {
        anchor.addEventListener('click', function(e) {
          var targetId = this.getAttribute('href').substring(1);
          if (!targetId) return;
          var targetEl = document.getElementById(targetId);
          if (targetEl) {
            e.preventDefault();
            targetEl.scrollIntoView({ behavior: 'smooth' });
          }
        });
      });

      // Interactive video card alert
      document.querySelectorAll('.videoContainer_A4x3').forEach(function(card) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', function() {
          var title = this.querySelector('h4') ? this.querySelector('h4').innerText : 'Omniverse Video';
          alert('Omniverse Benchmark Video: ' + title.replace(/\\n/g, ' ') + '\\nDetailed research video playback and benchmark analysis.');
        });
      });
    });
  })();
</script>
"""
    html = html.replace('</body>', interactive_script + '\n</body>')

    # Also ensure public/assets/css/styles.e5e949b8.css exists as fallback
    os.makedirs('demo/public/assets/css', exist_ok=True)
    with open('demo/src/rn-origin.css', 'r', encoding='utf-8') as src_css:
        css_content = src_css.read()
    with open('demo/public/assets/css/styles.e5e949b8.css', 'w', encoding='utf-8') as dest_css:
        dest_css.write(css_content)

    with open('demo/index.html', 'w', encoding='utf-8') as out:
        out.write(html)

    print('Successfully generated pixel-perfect demo/index.html')

if __name__ == '__main__':
    main()
