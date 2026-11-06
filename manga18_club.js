/**
 * Manga18.club — Venera comic source
 *
 * 站点事实（全部来自 2026-11-06 真实响应，见 manga18_debug/development_log.md）：
 * - 首页：Popular(10) / Manhwa Update(80) / Top day|month|all(各 10)
 * - 分类：/manga-list/{slug}/{page}，全部：/list-manga/{page}
 * - 搜索：GET /list-manga?search={kw}&page={n}
 * - 详情：/manhwa/{slug}，章节 a.chapter_num，href 真实存在多套旧路由：
 *   chapter-{n} / chap-{n} / 纯数字 311 / 139-5 / 102.5 / c123 / 114eng
 * - 更新：/list-manga?order_by=lastest&page={n} 是按最近更新排序的目录（20/页，167 页，
 *   实测第 1、2 页零重复）；详情 updateTime + 完整章节 Map 供客户端「追更」比对。
 * - 章节图片：页面内联脚本 var slides_p_path = ["<base64>", ...]，
 *   每个元素 base64 解码后是 https://cdn.manga18.club/manga/{slug}/chapters/{chapter}/NN.jpg
 *   图片为用户交互后才由站点脚本写入 #chapter_boxImages，Venera 只需自己解码该数组。
 * - 图片为明文 JPEG/PNG，无需 Referer 也能 200；仍按站点习惯附带章节 Referer。
 *
 * 版本记录：
 * - v1.0.0 首页 5 区块 + 分类 + 搜索 + 详情 + 章节图片。
 * - v1.1.0 新增「最近更新」分页探索页（连续浏览最新章节）；首页探索改为单请求 5 区块；
 *          详情 updateTime 配合完整章节 Map，支持客户端追更比对。
 */
class Manga18Club extends ComicSource {
  name = "Manga18";

  key = "manga18_club";

  version = "1.1.0";

  minAppVersion = "1.0.0";

  url = "";

  baseUrl = "https://manga18.club";

  imageCdnPrefix = "https://cdn.manga18.club/manga/";

  userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

  getHeaders(referer) {
    let headers = {
      "user-agent": this.userAgent,
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    };
    if (referer) {
      headers["referer"] = referer;
    }
    return headers;
  }

  async getText(url, referer) {
    let res = await Network.get(url, this.getHeaders(referer));
    if (!res) {
      throw "No response: " + url;
    }
    if (res.status !== 200) {
      if (res.status === 403) {
        throw "站点返回 403：Cloudflare/WAF 拒绝了当前客户端的 TLS 指纹，请确认网络出口后重试（" + url + "）";
      }
      if (res.status === 404) {
        throw "页面不存在 (404)：" + url;
      }
      throw "Invalid status code: " + res.status + " (" + url + ")";
    }
    let body = res.body ? String(res.body) : "";
    if (body.length < 500) {
      throw "Response too short: " + url;
    }
    return body;
  }

  absoluteUrl(value) {
    let url = String(value === undefined || value === null ? "" : value).trim();
    if (!url) {
      return "";
    }
    if (url.indexOf("data:") === 0) {
      return "";
    }
    if (url.indexOf("//") === 0) {
      return "https:" + url;
    }
    if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) {
      return url;
    }
    if (url.charAt(0) === "/") {
      return this.baseUrl + url;
    }
    return this.baseUrl + "/" + url;
  }

  slugFromHref(href) {
    let match = /\/manhwa\/([^\/?#]+)/.exec(String(href ? href : ""));
    if (!match) {
      return "";
    }
    return match[1];
  }

  textOf(root, selector) {
    if (!root) {
      return "";
    }
    let el = root.querySelector(selector);
    if (!el) {
      return "";
    }
    return String(el.text === undefined || el.text === null ? "" : el.text).trim();
  }

  attrOf(root, selector, attr) {
    if (!root) {
      return "";
    }
    let el = root.querySelector(selector);
    if (!el) {
      return "";
    }
    let attrs = el.attributes ? el.attributes : {};
    let value = attrs[attr];
    if (value === undefined || value === null) {
      return "";
    }
    return String(value).trim();
  }

  normalizeComicId(value) {
    if (value === undefined || value === null) {
      return "";
    }
    let raw = String(value).trim();
    if (!raw) {
      return "";
    }
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch (e) {
      decoded = raw;
    }
    let fromUrl = this.slugFromHref(decoded);
    if (fromUrl) {
      return fromUrl;
    }
    if (/^[A-Za-z0-9._-]+$/.test(decoded)) {
      return decoded;
    }
    return "";
  }

  episodeSlugFromText(value) {
    let raw = String(value === undefined || value === null ? "" : value).trim();
    if (!raw) {
      return "";
    }
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch (e) {
      decoded = raw;
    }
    let path = decoded.split("?")[0].split("#")[0];
    // 站点真实存在的章节路由：chapter-{n} / chap-{n} / 纯数字 311 / 139-5 / 102.5 / c123 / 114eng
    let match = /(?:^|\/)([A-Za-z0-9][A-Za-z0-9._-]*)\/?$/.exec(path);
    if (!match) {
      return "";
    }
    let slug = match[1];
    if (!/\d/.test(slug)) {
      return "";
    }
    if (slug === "manhwa" || slug === "chapter" || slug === "chap") {
      return "";
    }
    return slug;
  }

  /**
   * 把 Venera 可能传入的章节参数（纯 slug、完整 URL、slug|chapter-x、对象）标准化。
   * 无法识别或漫画 ID 不一致时返回 null，调用方不得发请求。
   */
  normalizeEpisode(comicId, epId) {
    let comic = this.normalizeComicId(comicId);
    let raw = "";
    if (epId === undefined || epId === null) {
      return null;
    }
    if (typeof epId === "object") {
      if (epId.epId !== undefined && epId.epId !== null) {
        raw = String(epId.epId);
      } else if (epId.chapterId !== undefined && epId.chapterId !== null) {
        raw = String(epId.chapterId);
      } else if (epId.url !== undefined && epId.url !== null) {
        raw = String(epId.url);
      } else {
        return null;
      }
    } else {
      raw = String(epId);
    }
    raw = raw.trim();
    if (!raw) {
      return null;
    }

    let epSlug = "";
    let embeddedComic = "";
    let parts = raw.split("|");
    if (parts.length === 2) {
      embeddedComic = this.normalizeComicId(parts[0]);
      epSlug = this.episodeSlugFromText(parts[1]);
    } else {
      let match = /\/manhwa\/([^\/?#]+)\/([^\/?#]+)\/?$/.exec(raw);
      if (match) {
        embeddedComic = match[1];
        epSlug = this.episodeSlugFromText(match[2]);
      } else {
        epSlug = this.episodeSlugFromText(raw);
      }
    }

    if (!epSlug) {
      return null;
    }
    if (comic && epSlug === comic) {
      return null;
    }
    if (embeddedComic && comic && embeddedComic !== comic) {
      return null;
    }
    if (!comic) {
      comic = embeddedComic;
    }
    if (!comic) {
      return null;
    }
    return { comic: comic, ep: epSlug };
  }

  chapterUrl(comicId, epSlug) {
    return this.baseUrl + "/manhwa/" + comicId + "/" + epSlug;
  }

  parseCard(item) {
    if (!item) {
      return null;
    }
    let linkEl = item.querySelector(".story_name a");
    if (!linkEl) {
      linkEl = item.querySelector(".mg_name a");
    }
    if (!linkEl) {
      linkEl = item.querySelector("a");
    }
    if (!linkEl) {
      return null;
    }
    let attrs = linkEl.attributes ? linkEl.attributes : {};
    let href = attrs["href"] ? String(attrs["href"]) : "";
    let id = this.slugFromHref(href);
    if (!id) {
      return null;
    }
    let title = String(linkEl.text ? linkEl.text : "").trim();
    if (!title) {
      title = id;
    }

    let cover = "";
    let imgEl = item.querySelector("img");
    if (imgEl) {
      let imgAttrs = imgEl.attributes ? imgEl.attributes : {};
      cover = imgAttrs["data-src"] || imgAttrs["data-original"] || imgAttrs["src"] || "";
    }
    cover = this.absoluteUrl(cover);

    let chapterTitle = this.textOf(item, ".mg_chapter .chapter_count a");
    if (!chapterTitle) {
      chapterTitle = this.textOf(item, ".story_chapter a");
    }
    let timeText = this.textOf(item, ".mg_chapter .chapter_time span");
    if (!timeText) {
      timeText = this.textOf(item, ".story_time span");
    }
    let subTitle = chapterTitle;
    if (timeText) {
      subTitle = subTitle ? subTitle + " · " + timeText : timeText;
    }

    return new Comic({
      id: id,
      title: title,
      cover: cover,
      subTitle: subTitle,
      tags: [],
    });
  }

  collectCards(root, selector) {
    if (!root) {
      return [];
    }
    let nodes = root.querySelectorAll(selector);
    let comics = [];
    let seen = {};
    for (let i = 0; i < nodes.length; i++) {
      let comic = this.parseCard(nodes[i]);
      if (!comic) {
        continue;
      }
      if (seen[comic.id]) {
        continue;
      }
      seen[comic.id] = true;
      comics.push(comic);
    }
    return comics;
  }

  parseMaxPage(doc, fallback) {
    let links = doc.querySelectorAll(".pagination a");
    let max = 0;
    for (let i = 0; i < links.length; i++) {
      let attrs = links[i].attributes ? links[i].attributes : {};
      let href = attrs["href"] ? String(attrs["href"]) : "";
      if (!href) {
        continue;
      }
      let number = 0;
      let queryMatch = /[?&]page=(\d+)/.exec(href);
      if (queryMatch) {
        number = parseInt(queryMatch[1], 10);
      } else {
        let pathMatch = /\/(\d+)\/?$/.exec(href);
        if (pathMatch) {
          number = parseInt(pathMatch[1], 10);
        }
      }
      if (number > max) {
        max = number;
      }
    }
    if (max < 1) {
      return fallback;
    }
    return max;
  }

  chapterNumber(slug) {
    let text = String(slug ? slug : "");
    // 真实样本: chapter-323 / chapter-321-5 / chap-1 / 311 / 139-5 / 102.5 / c123 / 114eng / 94-eng
    let match = /(\d+(?:[.-]\d+)?)/.exec(text);
    if (!match) {
      return -1;
    }
    return parseFloat(match[1].replace("-", "."));
  }

  parseSiteDate(value) {
    let text = String(value === undefined || value === null ? "" : value).trim();
    let match = /^(\d{1,2})-(\d{1,2})-(\d{4})/.exec(text);
    if (!match) {
      return "";
    }
    let day = parseInt(match[1], 10);
    let month = parseInt(match[2], 10);
    let year = parseInt(match[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return "";
    }
    let monthText = month < 10 ? "0" + month : String(month);
    let dayText = day < 10 ? "0" + day : String(day);
    return year + "-" + monthText + "-" + dayText;
  }

  decodeBase64Text(value) {
    let text = String(value === undefined || value === null ? "" : value).replace(/\s+/g, "");
    if (!text) {
      return "";
    }
    let remainder = text.length % 4;
    if (remainder === 1) {
      return "";
    }
    if (remainder === 2) {
      text += "==";
    } else if (remainder === 3) {
      text += "=";
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
      return "";
    }
    try {
      let buffer = Convert.decodeBase64(text);
      if (!buffer) {
        return "";
      }
      return String(Convert.decodeUtf8(buffer)).trim();
    } catch (e) {
      return "";
    }
  }

  isChapterImage(url) {
    let value = String(url === undefined || url === null ? "" : url).trim();
    if (!value) {
      return false;
    }
    if (value.indexOf(this.imageCdnPrefix) !== 0) {
      return false;
    }
    let path = value.split("?")[0].split("#")[0];
    if (path.indexOf("/chapters/") < 0) {
      return false;
    }
    return /\.(jpg|jpeg|png|webp|gif)$/i.test(path);
  }

  /**
   * 章节页把图片列表写在 var slides_p_path = ["<base64>", ...] 中，
   * 站点自己用 atob 解码后写入 #chapter_boxImages。源只做无副作用的 base64 解码。
   */
  extractImages(html) {
    let source = String(html === undefined || html === null ? "" : html);
    let urls = [];
    let arrayMatch = /slides_p_path\s*=\s*\[([\s\S]*?)\]/.exec(source);
    if (arrayMatch) {
      let itemRegex = /"([^"]*)"/g;
      let item = itemRegex.exec(arrayMatch[1]);
      while (item !== null) {
        let url = this.decodeBase64Text(item[1]);
        if (this.isChapterImage(url)) {
          urls.push(url);
        }
        item = itemRegex.exec(arrayMatch[1]);
      }
    }

    if (urls.length === 0) {
      let doc = new HtmlDocument(source);
      try {
        let nodes = doc.querySelectorAll(".chapter_boxImages img");
        for (let i = 0; i < nodes.length; i++) {
          let attrs = nodes[i].attributes ? nodes[i].attributes : {};
          let src = attrs["data-src"] || attrs["data-original"] || attrs["src"] || "";
          let url = this.absoluteUrl(src);
          if (this.isChapterImage(url)) {
            urls.push(url);
          }
        }
      } finally {
        doc.dispose();
      }
    }

    let seen = {};
    let result = [];
    for (let i = 0; i < urls.length; i++) {
      if (seen[urls[i]]) {
        continue;
      }
      seen[urls[i]] = true;
      result.push(urls[i]);
    }
    return result;
  }

  // explore page list
  explore = [
    {
      title: "Manga18",
      type: "singlePageWithMultiPart",
      load: async () => {
        let homeUrl = this.baseUrl + "/";
        let body = await this.getText(homeUrl);
        let doc = new HtmlDocument(body);
        let result = {};
        try {
          let popular = this.collectCards(doc, ".mg_update-content .story_item");
          if (popular.length > 0) {
            result["热门推荐"] = popular;
          }
          let update = this.collectCards(doc, ".recoment_box .story_item");
          if (update.length > 0) {
            result["最新更新"] = update;
          }
          let day = this.collectCards(doc, "#top_day .story_item");
          if (day.length > 0) {
            result["日榜"] = day;
          }
          let month = this.collectCards(doc, "#top_month .story_item");
          if (month.length > 0) {
            result["月榜"] = month;
          }
          let all = this.collectCards(doc, "#top_all .story_item");
          if (all.length > 0) {
            result["总榜"] = all;
          }
        } finally {
          doc.dispose();
        }

        if (Object.keys(result).length === 0) {
          throw "首页没有解析到任何漫画区块";
        }
        return result;
      },
      loadNext(next) {},
    },
    {
      // 连续浏览最新章节：站点真实排序目录（order_by=lastest），20/页、167 页
      title: "最近更新",
      type: "multiPageComicList",
      load: async (page) => {
        let pageNumber = parseInt(page, 10);
        if (!pageNumber || pageNumber < 1) {
          pageNumber = 1;
        }
        let url =
          this.baseUrl + "/list-manga?order_by=lastest&page=" + pageNumber;
        let body = await this.getText(url, this.baseUrl + "/list-manga");
        let doc = new HtmlDocument(body);
        let comics;
        let maxPage;
        try {
          comics = this.collectCards(doc, ".grid_content .story_item");
          if (comics.length === 0) {
            comics = this.collectCards(doc, ".story_item");
          }
          maxPage = this.parseMaxPage(doc, pageNumber);
        } finally {
          doc.dispose();
        }
        return { comics: comics, maxPage: maxPage };
      },
      loadNext(next) {},
    },
  ];

  // categories
  category = {
    title: "Manga18",
    parts: [
      {
        name: "题材",
        type: "fixed",
        itemType: "category",
        categories: [
          "全部",
          "Action",
          "Adult",
          "Adventure",
          "Comedy",
          "Comic",
          "Doujinshi",
          "Drama",
          "Ecchi",
          "Fantasy",
          "Gender Bender",
          "Harem",
          "Historical",
          "Horror",
          "Josei",
          "Manhwa",
          "Mature",
          "Mystery",
          "One shot",
          "Psychological",
          "Raw",
          "Romance",
          "School Life",
          "Sci-fi",
          "Seinen",
          "Shoujo",
          "Shounen",
          "Slice of Life",
          "Smut",
          "Sports",
          "Supernatural",
          "Tragedy",
          "Uncensored",
          "Yaoi",
          "18+",
        ],
        categoryParams: [
          "all",
          "action",
          "adult",
          "Adventure",
          "comedy",
          "comic",
          "doujinshi",
          "drama",
          "Ecchi",
          "Fantasy",
          "Gender-Bender",
          "Harem",
          "historical",
          "Horror",
          "Josei",
          "Manhwa",
          "Mature",
          "mystery",
          "one-shot",
          "psychological",
          "raw",
          "romance",
          "school-life",
          "sci-fi",
          "seinen",
          "Shoujo",
          "Shounen",
          "slice-of-life",
          "Smut",
          "Sports",
          "supernatural",
          "Tragedy",
          "Uncensored",
          "Yaoi",
          "18",
        ],
      },
    ],
    enableRankingPage: false,
  };

  // category comic loading related
  categoryComics = {
    load: async (category, param, options, page) => {
      let pageNumber = parseInt(page, 10);
      if (!pageNumber || pageNumber < 1) {
        pageNumber = 1;
      }
      let slug = String(param === undefined || param === null ? "" : param).trim();
      let url;
      if (!slug || slug === "all") {
        url = this.baseUrl + "/list-manga/" + pageNumber;
      } else {
        url = this.baseUrl + "/manga-list/" + encodeURIComponent(slug) + "/" + pageNumber;
      }
      let body = await this.getText(url);
      let doc = new HtmlDocument(body);
      let comics;
      let maxPage;
      try {
        comics = this.collectCards(doc, ".grid_content .story_item");
        if (comics.length === 0) {
          comics = this.collectCards(doc, ".story_item");
        }
        maxPage = this.parseMaxPage(doc, pageNumber);
      } finally {
        doc.dispose();
      }
      return { comics: comics, maxPage: maxPage };
    },
  };

  // search related
  search = {
    load: async (keyword, options, page) => {
      let pageNumber = parseInt(page, 10);
      if (!pageNumber || pageNumber < 1) {
        pageNumber = 1;
      }
      let word = String(keyword === undefined || keyword === null ? "" : keyword).trim();
      if (!word) {
        return { comics: [], maxPage: 1 };
      }
      let url =
        this.baseUrl +
        "/list-manga?search=" +
        encodeURIComponent(word) +
        "&page=" +
        pageNumber;
      let body = await this.getText(url);
      let doc = new HtmlDocument(body);
      let comics;
      let maxPage;
      try {
        comics = this.collectCards(doc, ".grid_content .story_item");
        if (comics.length === 0) {
          comics = this.collectCards(doc, ".story_item");
        }
        maxPage = this.parseMaxPage(doc, 1);
      } finally {
        doc.dispose();
      }
      return { comics: comics, maxPage: maxPage };
    },
    enableTagsSuggestions: false,
  };

  // single comic related
  comic = {
    loadInfo: async (id) => {
      let comicId = this.normalizeComicId(id);
      if (!comicId) {
        throw "漫画 ID 无效: " + id;
      }
      let url = this.baseUrl + "/manhwa/" + comicId;
      let body = await this.getText(url);
      let doc = new HtmlDocument(body);
      try {
        let title = this.textOf(doc, ".detail_name h1");
        if (!title) {
          title = this.textOf(doc, "h1");
        }
        let cover = this.absoluteUrl(this.attrOf(doc, ".detail_avatar img", "src"));
        let description = this.textOf(doc, ".detail_review .detail_reviewContent");

        let author = "";
        let artist = "";
        let status = "";
        let infoItems = doc.querySelectorAll(".detail_listInfo .item");
        for (let i = 0; i < infoItems.length; i++) {
          let item = infoItems[i];
          let label = this.textOf(item, ".info_label").toLowerCase();
          let value = this.textOf(item, ".info_value");
          if (!label || !value) {
            continue;
          }
          if (label.indexOf("author") >= 0 && !author) {
            author = value;
          } else if (label.indexOf("artist") >= 0 && !artist) {
            artist = value;
          } else if (label.indexOf("status") >= 0 && !status) {
            status = value;
          }
        }

        let genres = [];
        let genreSeen = {};
        let genreLinks = doc.querySelectorAll(".detail_listInfo .info_value a");
        for (let i = 0; i < genreLinks.length; i++) {
          let attrs = genreLinks[i].attributes ? genreLinks[i].attributes : {};
          let href = attrs["href"] ? String(attrs["href"]) : "";
          if (href.indexOf("/manga-list/") < 0) {
            continue;
          }
          let name = String(genreLinks[i].text ? genreLinks[i].text : "").trim();
          if (!name || genreSeen[name]) {
            continue;
          }
          genreSeen[name] = true;
          genres.push(name);
        }

        let chapterNodes = doc.querySelectorAll("a.chapter_num");
        let entries = [];
        for (let i = 0; i < chapterNodes.length; i++) {
          let attrs = chapterNodes[i].attributes ? chapterNodes[i].attributes : {};
          let href = attrs["href"] ? String(attrs["href"]) : "";
          let path = href.split("?")[0].split("#")[0];
          let segments = path.split("/");
          let epSlug = segments.length > 0 ? segments[segments.length - 1] : "";
          if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(epSlug) || !/\d/.test(epSlug)) {
            continue;
          }
          if (epSlug === comicId) {
            continue;
          }
          let chapterTitle = String(chapterNodes[i].text ? chapterNodes[i].text : "").trim();
          if (!chapterTitle) {
            chapterTitle = epSlug;
          }
          entries.push({ slug: epSlug, title: chapterTitle });
        }

        let updateTime = "";
        if (chapterNodes.length > 0) {
          let rowParent = chapterNodes[0].parent;
          if (rowParent) {
            updateTime = this.parseSiteDate(this.textOf(rowParent, ".chapter_info"));
          }
        }

        entries.sort((a, b) => {
          let left = this.chapterNumber(a.slug);
          let right = this.chapterNumber(b.slug);
          if (left === right) {
            return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
          }
          return left - right;
        });

        let chapters = new Map();
        for (let i = 0; i < entries.length; i++) {
          chapters.set(entries[i].slug, entries[i].title);
        }
        if (chapters.size === 0) {
          throw "该漫画没有解析到章节: " + comicId;
        }

        let tags = {};
        if (author) {
          tags["作者"] = [author];
        }
        if (artist) {
          tags["画师"] = [artist];
        }
        if (status) {
          tags["状态"] = [status];
        }
        if (genres.length > 0) {
          tags["标签"] = genres;
        }

        return new ComicDetails({
          title: title ? title : comicId,
          subtitle: author,
          cover: cover,
          description: description,
          tags: tags,
          chapters: chapters,
          isFavorite: false,
          subId: comicId,
          thumbnails: cover ? [cover] : [],
          recommend: [],
          updateTime: updateTime,
          url: url,
        });
      } finally {
        doc.dispose();
      }
    },

    loadEp: async (comicId, epId) => {
      let target = this.normalizeEpisode(comicId, epId);
      if (!target) {
        console.log("loadEp: 无法识别章节参数 comicId=" + comicId + " epId=" + epId);
        return { images: [] };
      }
      let url = this.chapterUrl(target.comic, target.ep);
      let body = await this.getText(url);
      let images = this.extractImages(body);
      if (images.length === 0) {
        throw "章节没有图片: " + target.ep;
      }
      return { images: images };
    },

    onImageLoad: (url, comicId, epId) => {
      let target = this.normalizeEpisode(comicId, epId);
      let referer = this.baseUrl + "/";
      if (target) {
        referer = this.chapterUrl(target.comic, target.ep);
      }
      return {
        headers: {
          "user-agent": this.userAgent,
          "referer": referer,
          accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
      };
    },

    onThumbnailLoad: (url) => {
      return {
        headers: {
          "user-agent": this.userAgent,
          "referer": this.baseUrl + "/",
          accept: "image/*,*/*;q=0.8",
        },
      };
    },
  };
}
