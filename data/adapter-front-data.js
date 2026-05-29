window.ADAPTER_PROFILE_DATA = {
  "version": "0.1.0",
  "updated_at": "2026-05-29",
  "summary": {
    "direct_article_feeds": 5,
    "adapter_sources": 17,
    "platform_profiles": 7,
    "ready_rules": 15,
    "fallback_rules": 4
  },
  "direct_article_feeds": [
    {
      "journal_id": "j13",
      "journal_name": "ACADEMY OF MANAGEMENT REVIEW",
      "feed_url": "https://journals.aom.org/action/showFeed?jc=amr&type=etoc&feed=rss",
      "parser_profile": "atypon-etoc"
    },
    {
      "journal_id": "j14",
      "journal_name": "JOURNAL OF FINANCE",
      "feed_url": "https://onlinelibrary.wiley.com/action/showFeed?jc=15406261&type=etoc&feed=rss",
      "parser_profile": "wiley-etoc"
    },
    {
      "journal_id": "j17",
      "journal_name": "JOURNAL OF POLITICAL ECONOMY",
      "feed_url": "https://www.journals.uchicago.edu/action/showFeed?jc=jpe&type=etoc&feed=rss",
      "parser_profile": "atypon-etoc"
    },
    {
      "journal_id": "j20",
      "journal_name": "ECONOMETRICA",
      "feed_url": "https://onlinelibrary.wiley.com/action/showFeed?jc=14680262&type=etoc&feed=rss",
      "parser_profile": "wiley-etoc"
    },
    {
      "journal_id": "j21",
      "journal_name": "ACADEMY OF MANAGEMENT JOURNAL",
      "feed_url": "https://journals.aom.org/action/showFeed?jc=amj&type=etoc&feed=rss",
      "parser_profile": "atypon-etoc"
    }
  ],
  "platform_profiles": [
    {
      "id": "ajcass",
      "name": "AJCass 社科院平台",
      "strategy": "公开 JSON 接口优先，旧版站点走静态 HTML",
      "render_required": true,
      "fields": [
        "title",
        "url",
        "issue",
        "year",
        "authors",
        "abstract"
      ],
      "next_action": "经济研究、中国农村经济可走 api.ajcass.com 当期目录；中国工业经济走 /Magazine/Show 静态条目。",
      "journals": [
        "j2",
        "j4",
        "j12"
      ]
    },
    {
      "id": "cn-journal-cms",
      "name": "中文期刊 CMS / Magtech",
      "strategy": "CSS/XPath 静态抽取",
      "render_required": false,
      "fields": [
        "title",
        "url",
        "issue",
        "date",
        "authors"
      ],
      "next_action": "抓主页或当期目录页，只保留文章详情 URL，排除公告、栏目和期号页。",
      "journals": [
        "j3",
        "j5"
      ]
    },
    {
      "id": "cnki-cbpt",
      "name": "CNKI / 采编平台",
      "strategy": "动态渲染 + 接口嗅探",
      "render_required": true,
      "fields": [
        "title",
        "official_url",
        "pdf_url",
        "issue",
        "authors",
        "abstract"
      ],
      "next_action": "公共管理学报可直接抓 paper 页面；管理世界主站验证码阻断时先用 Macrodatas 做发现源，再按发现到的期号尝试 NCPSD 官方详情升级；官方未上架前仍保持 discovery_url。",
      "journals": [
        "j6",
        "j8"
      ]
    },
    {
      "id": "university-custom",
      "name": "高校自建站",
      "strategy": "CSS/XPath，单刊参数化",
      "render_required": false,
      "fields": [
        "title",
        "official_url",
        "pdf_url",
        "issue",
        "date",
        "authors"
      ],
      "next_action": "管理科学学报先从 issue/browser 找最新期，再进入期号页抽 article/abstract；站点抖动时兜底到 ch/reader/issue_query.aspx。南开管理评论先用 Macrodatas 做发现源，再按发现到的期号尝试 NCPSD 官方详情升级。",
      "journals": [
        "j7",
        "j9"
      ]
    },
    {
      "id": "association-custom",
      "name": "协会 / 自建系统",
      "strategy": "先修 URL，再静态抽取",
      "render_required": false,
      "fields": [
        "title",
        "official_url",
        "pdf_url",
        "issue",
        "date"
      ],
      "next_action": "会计研究切换到 asc.net.cn 当期列表；中国行政管理用维普 SSR 目录发现条目，再用 NCPSD 期号页解析文章详情；维普链接只保留为 discovery_url。",
      "journals": [
        "j10",
        "j11"
      ]
    },
    {
      "id": "publisher-html",
      "name": "英文出版平台页面",
      "strategy": "出版平台模板 + 反爬兜底",
      "render_required": true,
      "fields": [
        "title",
        "url",
        "doi",
        "issue",
        "date",
        "authors"
      ],
      "next_action": "AEA 可直接抽取 forthcoming/current issue；AAAHQ/OUP 页面 403 时走 Crossref/OpenAlex 开放元数据兜底。",
      "journals": [
        "j15",
        "j16",
        "j18",
        "j19"
      ]
    },
    {
      "id": "non-article-feed",
      "name": "非论文 RSS 来源",
      "strategy": "排除公告/评论 RSS，改抓文章页",
      "render_required": false,
      "fields": [
        "title",
        "url",
        "issue",
        "date",
        "authors"
      ],
      "next_action": "AFA forthcoming 可由 DOI 反推 Wiley 文章页；ASQ 可从 Cornell 页抽 Sage DOI。",
      "journals": [
        "j1",
        "j22"
      ]
    }
  ],
  "adapter_queue": [
    {
      "journal_id": "j2",
      "journal_name": "经济研究",
      "platform_id": "ajcass",
      "platform_name": "AJCass 社科院平台",
      "strategy": "公开 JSON 接口优先，旧版站点走静态 HTML",
      "fields": [
        "title",
        "url",
        "issue",
        "year",
        "authors",
        "abstract"
      ],
      "status": "接口规则",
      "source_url": "https://erj.ajcass.com/#/index",
      "adapter_kind": "ajcass-current-api",
      "next_action": "经济研究、中国农村经济可走 api.ajcass.com 当期目录；中国工业经济走 /Magazine/Show 静态条目。",
      "render_required": true
    },
    {
      "journal_id": "j4",
      "journal_name": "中国工业经济",
      "platform_id": "ajcass",
      "platform_name": "AJCass 社科院平台",
      "strategy": "公开 JSON 接口优先，旧版站点走静态 HTML",
      "fields": [
        "title",
        "url",
        "issue",
        "year",
        "authors",
        "abstract"
      ],
      "status": "静态规则",
      "source_url": "http://ciejournal.ajcass.com/",
      "adapter_kind": "cie-legacy-html",
      "next_action": "经济研究、中国农村经济可走 api.ajcass.com 当期目录；中国工业经济走 /Magazine/Show 静态条目。",
      "render_required": true
    },
    {
      "journal_id": "j12",
      "journal_name": "中国农村经济",
      "platform_id": "ajcass",
      "platform_name": "AJCass 社科院平台",
      "strategy": "公开 JSON 接口优先，旧版站点走静态 HTML",
      "fields": [
        "title",
        "url",
        "issue",
        "year",
        "authors",
        "abstract"
      ],
      "status": "接口规则",
      "source_url": "https://zgncjj.ajcass.com/#/",
      "adapter_kind": "ajcass-current-api",
      "next_action": "经济研究、中国农村经济可走 api.ajcass.com 当期目录；中国工业经济走 /Magazine/Show 静态条目。",
      "render_required": true
    },
    {
      "journal_id": "j3",
      "journal_name": "世界经济",
      "platform_id": "cn-journal-cms",
      "platform_name": "中文期刊 CMS / Magtech",
      "strategy": "CSS/XPath 静态抽取",
      "fields": [
        "title",
        "url",
        "issue",
        "date",
        "authors"
      ],
      "status": "静态规则",
      "source_url": "https://sjjj.magtech.com.cn/CN/home",
      "adapter_kind": "magtech-cn-html",
      "next_action": "抓主页或当期目录页，只保留文章详情 URL，排除公告、栏目和期号页。",
      "render_required": false
    },
    {
      "journal_id": "j5",
      "journal_name": "金融研究",
      "platform_id": "cn-journal-cms",
      "platform_name": "中文期刊 CMS / Magtech",
      "strategy": "CSS/XPath 静态抽取",
      "fields": [
        "title",
        "url",
        "issue",
        "date",
        "authors"
      ],
      "status": "静态规则",
      "source_url": "http://www.jryj.org.cn/CN/1002-7246/home.shtml",
      "adapter_kind": "jryj-html",
      "next_action": "抓主页或当期目录页，只保留文章详情 URL，排除公告、栏目和期号页。",
      "render_required": false
    },
    {
      "journal_id": "j6",
      "journal_name": "管理世界",
      "platform_id": "cnki-cbpt",
      "platform_name": "CNKI / 采编平台",
      "strategy": "动态渲染 + 接口嗅探",
      "fields": [
        "title",
        "official_url",
        "pdf_url",
        "issue",
        "authors",
        "abstract"
      ],
      "status": "待官方详情上架",
      "source_url": "https://glsj.cbpt.cnki.net/WKB/WebPublication/wkTextContent.aspx?colType=4&tp=gklb&mid=glsj",
      "adapter_kind": "macrodatas-issue-list",
      "next_action": "公共管理学报可直接抓 paper 页面；管理世界主站验证码阻断时先用 Macrodatas 做发现源，再按发现到的期号尝试 NCPSD 官方详情升级；官方未上架前仍保持 discovery_url。",
      "render_required": true
    },
    {
      "journal_id": "j8",
      "journal_name": "公共管理学报",
      "platform_id": "cnki-cbpt",
      "platform_name": "CNKI / 采编平台",
      "strategy": "动态渲染 + 接口嗅探",
      "fields": [
        "title",
        "official_url",
        "pdf_url",
        "issue",
        "authors",
        "abstract"
      ],
      "status": "静态规则",
      "source_url": "https://gggl.cbpt.cnki.net/portal",
      "adapter_kind": "cnki-portal-paper",
      "next_action": "公共管理学报可直接抓 paper 页面；管理世界主站验证码阻断时先用 Macrodatas 做发现源，再按发现到的期号尝试 NCPSD 官方详情升级；官方未上架前仍保持 discovery_url。",
      "render_required": true
    },
    {
      "journal_id": "j7",
      "journal_name": "南开管理评论",
      "platform_id": "university-custom",
      "platform_name": "高校自建站",
      "strategy": "CSS/XPath，单刊参数化",
      "fields": [
        "title",
        "official_url",
        "pdf_url",
        "issue",
        "date",
        "authors"
      ],
      "status": "待官方详情上架",
      "source_url": "https://nbr.nankai.edu.cn/nkglpl/home",
      "adapter_kind": "macrodatas-issue-list",
      "next_action": "管理科学学报先从 issue/browser 找最新期，再进入期号页抽 article/abstract；站点抖动时兜底到 ch/reader/issue_query.aspx。南开管理评论先用 Macrodatas 做发现源，再按发现到的期号尝试 NCPSD 官方详情升级。",
      "render_required": false
    },
    {
      "journal_id": "j9",
      "journal_name": "管理科学学报",
      "platform_id": "university-custom",
      "platform_name": "高校自建站",
      "strategy": "CSS/XPath，单刊参数化",
      "fields": [
        "title",
        "official_url",
        "pdf_url",
        "issue",
        "date",
        "authors"
      ],
      "status": "期号规则",
      "source_url": "https://jmsc.tju.edu.cn/jmsc/issue/browser",
      "adapter_kind": "jmsc-issue-html",
      "next_action": "管理科学学报先从 issue/browser 找最新期，再进入期号页抽 article/abstract；站点抖动时兜底到 ch/reader/issue_query.aspx。南开管理评论先用 Macrodatas 做发现源，再按发现到的期号尝试 NCPSD 官方详情升级。",
      "render_required": false
    },
    {
      "journal_id": "j10",
      "journal_name": "中国行政管理",
      "platform_id": "association-custom",
      "platform_name": "协会 / 自建系统",
      "strategy": "先修 URL，再静态抽取",
      "fields": [
        "title",
        "official_url",
        "pdf_url",
        "issue",
        "date"
      ],
      "status": "文献中心详情解析",
      "source_url": "https://www.cqvip.com/journal/81961X",
      "adapter_kind": "cqvip-journal-html",
      "next_action": "会计研究切换到 asc.net.cn 当期列表；中国行政管理用维普 SSR 目录发现条目，再用 NCPSD 期号页解析文章详情；维普链接只保留为 discovery_url。",
      "render_required": false
    },
    {
      "journal_id": "j11",
      "journal_name": "会计研究",
      "platform_id": "association-custom",
      "platform_name": "协会 / 自建系统",
      "strategy": "先修 URL，再静态抽取",
      "fields": [
        "title",
        "official_url",
        "pdf_url",
        "issue",
        "date"
      ],
      "status": "新官网当期列表",
      "source_url": "https://www.asc.net.cn/AccountingResearch/NewestArticleListCS.aspx",
      "adapter_kind": "asc-current-issue-html",
      "next_action": "会计研究切换到 asc.net.cn 当期列表；中国行政管理用维普 SSR 目录发现条目，再用 NCPSD 期号页解析文章详情；维普链接只保留为 discovery_url。",
      "render_required": false
    },
    {
      "journal_id": "j15",
      "journal_name": "ACCOUNTING REVIEW",
      "platform_id": "publisher-html",
      "platform_name": "英文出版平台页面",
      "strategy": "出版平台模板 + 反爬兜底",
      "fields": [
        "title",
        "url",
        "doi",
        "issue",
        "date",
        "authors"
      ],
      "status": "开放元数据兜底",
      "source_url": "https://publications.aaahq.org/accounting-review",
      "adapter_kind": "open-metadata-works",
      "next_action": "AEA 可直接抽取 forthcoming/current issue；AAAHQ/OUP 页面 403 时走 Crossref/OpenAlex 开放元数据兜底。",
      "render_required": true
    },
    {
      "journal_id": "j16",
      "journal_name": "AMERICAN ECONOMIC REVIEW",
      "platform_id": "publisher-html",
      "platform_name": "英文出版平台页面",
      "strategy": "出版平台模板 + 反爬兜底",
      "fields": [
        "title",
        "url",
        "doi",
        "issue",
        "date",
        "authors"
      ],
      "status": "静态规则",
      "source_url": "https://www.aeaweb.org/journals/aer/forthcoming",
      "adapter_kind": "aea-forthcoming-html",
      "next_action": "AEA 可直接抽取 forthcoming/current issue；AAAHQ/OUP 页面 403 时走 Crossref/OpenAlex 开放元数据兜底。",
      "render_required": true
    },
    {
      "journal_id": "j18",
      "journal_name": "QUARTERLY JOURNAL OF ECONOMICS",
      "platform_id": "publisher-html",
      "platform_name": "英文出版平台页面",
      "strategy": "出版平台模板 + 反爬兜底",
      "fields": [
        "title",
        "url",
        "doi",
        "issue",
        "date",
        "authors"
      ],
      "status": "开放元数据兜底",
      "source_url": "https://academic.oup.com/qje",
      "adapter_kind": "open-metadata-works",
      "next_action": "AEA 可直接抽取 forthcoming/current issue；AAAHQ/OUP 页面 403 时走 Crossref/OpenAlex 开放元数据兜底。",
      "render_required": true
    },
    {
      "journal_id": "j19",
      "journal_name": "REVIEW OF ECONOMIC STUDIES",
      "platform_id": "publisher-html",
      "platform_name": "英文出版平台页面",
      "strategy": "出版平台模板 + 反爬兜底",
      "fields": [
        "title",
        "url",
        "doi",
        "issue",
        "date",
        "authors"
      ],
      "status": "开放元数据兜底",
      "source_url": "https://academic.oup.com/restud",
      "adapter_kind": "open-metadata-works",
      "next_action": "AEA 可直接抽取 forthcoming/current issue；AAAHQ/OUP 页面 403 时走 Crossref/OpenAlex 开放元数据兜底。",
      "render_required": true
    },
    {
      "journal_id": "j1",
      "journal_name": "JOURNAL OF FINANCE",
      "platform_id": "non-article-feed",
      "platform_name": "非论文 RSS 来源",
      "strategy": "排除公告/评论 RSS，改抓文章页",
      "fields": [
        "title",
        "url",
        "issue",
        "date",
        "authors"
      ],
      "status": "DOI 反推规则",
      "source_url": "https://afajof.org/forthcoming-articles/",
      "adapter_kind": "afa-forthcoming-doi",
      "next_action": "AFA forthcoming 可由 DOI 反推 Wiley 文章页；ASQ 可从 Cornell 页抽 Sage DOI。",
      "render_required": false
    },
    {
      "journal_id": "j22",
      "journal_name": "ADMINISTRATIVE SCIENCE QUARTERLY",
      "platform_id": "non-article-feed",
      "platform_name": "非论文 RSS 来源",
      "strategy": "排除公告/评论 RSS，改抓文章页",
      "fields": [
        "title",
        "url",
        "issue",
        "date",
        "authors"
      ],
      "status": "静态规则",
      "source_url": "https://www.johnson.cornell.edu/administrative-science-quarterly/",
      "adapter_kind": "asq-sage-links",
      "next_action": "AFA forthcoming 可由 DOI 反推 Wiley 文章页；ASQ 可从 Cornell 页抽 Sage DOI。",
      "render_required": false
    }
  ]
};
