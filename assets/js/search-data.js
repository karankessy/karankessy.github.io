// get the ninja-keys element
const ninja = document.querySelector('ninja-keys');

// add the home and posts menu items
ninja.data = [{
    id: "nav-about",
    title: "about",
    section: "Navigation",
    handler: () => {
      window.location.href = "/";
    },
  },{id: "nav-blog",
          title: "blog",
          description: "",
          section: "Navigation",
          handler: () => {
            window.location.href = "/blog/";
          },
        },{id: "post-why-your-api-works-in-postman-but-fails-in-the-browser",
        
          title: "Why Your API Works in Postman but Fails in the Browser",
        
        description: "An in-depth exploration of Cross-Origin Resource Sharing (CORS), preflight requests, and common pitfalls, accompanied by a hands-on demo.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2026/understanding-cors/";
          
        },
      },{id: "post-f5-big-ip-wazuh-getting-logs-working-after-18-months",
        
          title: "F5 BIG-IP + Wazuh: Getting Logs Working After 18 Months",
        
        description: "How I finally got F5 BIG-IP and Wazuh to exchange logs — configuration steps, troubleshooting, and lessons learned from an 18-month integration.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2025/f5-bigip-wazuh-logging/";
          
        },
      },{id: "post-toon-the-new-json",
        
          title: "TOON - The New JSON",
        
        description: "TOON is about to take a wild ride in LLMs. Its going to save you money, time &amp; power. Go through it.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2025/toon-the-new-json/";
          
        },
      },{id: "post-three-essential-http-routing-patterns",
        
          title: "Three Essential HTTP Routing Patterns",
        
        description: "HTTP routing patterns - the three crucial approaches (Host-based, Path-based, and Header-based) that determine how web traffic is directed to different services, enabling efficient request handling and service management in modern web architectures.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2025/http-routing-patterns/";
          
        },
      },{id: "post-webassembly-will-this-replace-docker",
        
          title: "WebAssembly: Will this replace Docker?",
        
        description: "WebAssembly vs Docker. WASM, a technology that revamped the way we thought about containerization.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2024/webassembly-vs-docker/";
          
        },
      },{id: "post-engineering-behind-mutable-and-immutable-in-python",
        
          title: "Engineering behind Mutable and Immutable in Python",
        
        description: "Explore the core engineering concepts behind mutable and immutable data types in Python with simple explanations and practical examples.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2024/mutable-immutable-python/";
          
        },
      },{id: "post-a-guide-to-analyzing-and-evaluating-reasoning",
        
          title: "A Guide to Analyzing and Evaluating Reasoning",
        
        description: "Here we explore the essential techniques for analyzing and evaluating reasoning in arguments. Learn how to identify claims, premises, and conclusions, and strengthen your critical thinking skills.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2024/analyzing-evaluating-reasoning/";
          
        },
      },{id: "post-how-we-fixed-critical-connectivity-issues-in-our-vkyc-application-a-technical-deep-dive",
        
          title: "How We Fixed Critical Connectivity Issues in Our vKYC Application: A Technical Deep...",
        
        description: "A detailed exploration of how our team diagnosed and resolved persistent connectivity issues in our video KYC application, offering valuable insights for technical teams facing similar challenges.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2024/vkyc-connectivity-issues/";
          
        },
      },{id: "post-threat-classification",
        
          title: "Threat Classification",
        
        description: "Understanding the four categories of threat classification in cybersecurity - known-knowns, known-unknowns, unknown-knowns, and unknown-unknowns.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2024/threat-classification/";
          
        },
      },{id: "post-f5-tmos-administration-essentials-critical-concepts-to-be-remembered",
        
          title: "F5 TMOS Administration Essentials: Critical Concepts to be Remembered",
        
        description: "Explore crucial aspects of F5 TMOS administration, from packet processing flow to advanced troubleshooting techniques. A comprehensive guide for network administrators and DevOps professionals.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2024/f5-tmos-administration-essentials/";
          
        },
      },{id: "post-understanding-trust-authorities-in-big-ip-systems-a-beginner-39-s-guide",
        
          title: "Understanding Trust Authorities in BIG-IP Systems: A Beginner&#39;s Guide",
        
        description: "Dive into the fundamentals of Device Trust Authorities in BIG-IP systems, exploring their types, roles, and essential configuration tips for a secure and efficient setup.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2024/trust-authorities-bigip/";
          
        },
      },{id: "post-reject-virtual-servers-in-big-ip-ltm-purpose-and-practical-use-cases",
        
          title: "Reject Virtual Servers in BIG-IP LTM: Purpose and Practical Use Cases",
        
        description: "Discover the role of Reject Virtual Servers in BIG-IP LTM, how they help manage unwanted traffic, and their practical applications in creating a secure and efficient network.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2024/reject-virtual-servers-bigip-ltm/";
          
        },
      },{id: "post-performance-http-virtual-servers-and-the-fast-http-profile-in-big-ip",
        
          title: "Performance HTTP Virtual Servers and the Fast HTTP Profile in BIG-IP",
        
        description: "Gain insights into the workings of Performance HTTP Virtual Servers and the Fast HTTP Profile in BIG-IP, exploring their advantages, limitations, and ideal use cases.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2024/performance-http-virtual-servers-bigip/";
          
        },
      },{id: "post-immunize-your-photos-protecting-yourself-from-ai-deepfake-manipulation",
        
          title: "Immunize Your Photos: Protecting Yourself from AI Deepfake Manipulation",
        
        description: "Explore how MIT&#39;s innovative PhotoGuard tool can protect your photos from malicious AI editing and deepfakes. Learn how to safeguard your digital identity and stay ahead in the evolving landscape of AI technology.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2024/immunize-photos-ai-deepfake/";
          
        },
      },{id: "post-recent-surge-in-phishing-attacks-targeting-character-assassination",
        
          title: "Recent Surge in Phishing Attacks Targeting Character Assassination",
        
        description: "Explore the deceptive tactics of Facebook phishing attacks targeting character assassination. Learn how to safeguard your digital presence and protect your reputation from these cunning cybercriminals.",
        section: "Posts",
        handler: () => {
          
            window.location.href = "/blog/2024/phishing-attacks-character-assassination/";
          
        },
      },{id: "books-the-godfather",
          title: 'The Godfather',
          description: "",
          section: "Books",handler: () => {
              window.location.href = "/books/the_godfather/";
            },},{id: "projects-project-1",
          title: 'project 1',
          description: "with background image",
          section: "Projects",handler: () => {
              window.location.href = "/projects/1_project/";
            },},{id: "projects-project-2",
          title: 'project 2',
          description: "a project with a background image and giscus comments",
          section: "Projects",handler: () => {
              window.location.href = "/projects/2_project/";
            },},{id: "projects-project-3-with-very-long-name",
          title: 'project 3 with very long name',
          description: "a project that redirects to another website",
          section: "Projects",handler: () => {
              window.location.href = "/projects/3_project/";
            },},{id: "projects-project-4",
          title: 'project 4',
          description: "another without an image",
          section: "Projects",handler: () => {
              window.location.href = "/projects/4_project/";
            },},{id: "projects-project-5",
          title: 'project 5',
          description: "a project with a background image",
          section: "Projects",handler: () => {
              window.location.href = "/projects/5_project/";
            },},{id: "projects-project-6",
          title: 'project 6',
          description: "a project with no image",
          section: "Projects",handler: () => {
              window.location.href = "/projects/6_project/";
            },},{id: "projects-project-7",
          title: 'project 7',
          description: "with background image",
          section: "Projects",handler: () => {
              window.location.href = "/projects/7_project/";
            },},{id: "projects-project-8",
          title: 'project 8',
          description: "an other project with a background image and giscus comments",
          section: "Projects",handler: () => {
              window.location.href = "/projects/8_project/";
            },},{id: "projects-project-9",
          title: 'project 9',
          description: "another project with an image 🎉",
          section: "Projects",handler: () => {
              window.location.href = "/projects/9_project/";
            },},{id: "teachings-data-science-fundamentals",
          title: 'Data Science Fundamentals',
          description: "This course covers the foundational aspects of data science, including data collection, cleaning, analysis, and visualization. Students will learn practical skills for working with real-world datasets.",
          section: "Teachings",handler: () => {
              window.location.href = "/teachings/data-science-fundamentals/";
            },},{id: "teachings-introduction-to-machine-learning",
          title: 'Introduction to Machine Learning',
          description: "This course provides an introduction to machine learning concepts, algorithms, and applications. Students will learn about supervised and unsupervised learning, model evaluation, and practical implementations.",
          section: "Teachings",handler: () => {
              window.location.href = "/teachings/introduction-to-machine-learning/";
            },},{
        id: 'social-github',
        title: 'GitHub',
        section: 'Socials',
        handler: () => {
          window.open("https://github.com/karankessy", "_blank");
        },
      },{
        id: 'social-linkedin',
        title: 'LinkedIn',
        section: 'Socials',
        handler: () => {
          window.open("https://www.linkedin.com/in/karankessy", "_blank");
        },
      },{
        id: 'social-facebook',
        title: 'Facebook',
        section: 'Socials',
        handler: () => {
          window.open("https://facebook.com/karankessy", "_blank");
        },
      },{
        id: 'social-x',
        title: 'X',
        section: 'Socials',
        handler: () => {
          window.open("https://twitter.com/karankessy", "_blank");
        },
      },{
        id: 'social-instagram',
        title: 'Instagram',
        section: 'Socials',
        handler: () => {
          window.open("https://instagram.com/karankessy", "_blank");
        },
      },{
        id: 'social-rss',
        title: 'RSS Feed',
        section: 'Socials',
        handler: () => {
          window.open("/feed.xml", "_blank");
        },
      },{
      id: 'light-theme',
      title: 'Change theme to light',
      description: 'Change the theme of the site to Light',
      section: 'Theme',
      handler: () => {
        setThemeSetting("light");
      },
    },
    {
      id: 'dark-theme',
      title: 'Change theme to dark',
      description: 'Change the theme of the site to Dark',
      section: 'Theme',
      handler: () => {
        setThemeSetting("dark");
      },
    },
    {
      id: 'system-theme',
      title: 'Use system default theme',
      description: 'Change the theme of the site to System Default',
      section: 'Theme',
      handler: () => {
        setThemeSetting("system");
      },
    },];
