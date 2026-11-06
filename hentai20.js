/**
 * Hentai20.io — Venera comic source
 *
 * 站点事实（2026-11-06 真实响应，见 sources_batch2/development_log.md）：
 * - WordPress + Madara 系模板（bsx / imgu / imgseries / eplister）
 * - 首页 /home1/：热门 .popularslider .bsx(16)、最新 .listupd .imgu(20)、推荐 .series-gen .bsx(25)
 * - 分类：/genres/{slug}/page/{n}/（31 个真实题材）；全部：/manga/?status=&type=&order=popular&page={n}（30/页）
 * - 搜索：GET /?s={kw}，翻页 /page/{n}/?s={kw}
 * - 详情：/manga/{slug}/，章节 #chapterlist li a，href 为 /{manga-slug}-chapter-{n}/
 * - 章节图：正文 .entry-content 内的 <noscript><img src="https://img.hentai1.io/...">，
 *   文件名带随机 hash，只能从页面读取；图片为明文 JPEG，无需 Referer 也能 200
 */
class Hentai20 extends ComicSource {
  name = "Hentai20";
  key = "hentai20";
  version = "1.0.0";
  minAppVersion = "1.0.0";
  url = "";

  baseUrl = "https://hentai20.io";
  imageHostPattern = /^https?:\/\/img\.[a-z0-9.\-]+\//i;

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
        throw "站点返回 403（可能有反爬/地区限制）：" + url;
      }
      if (res.status === 404) {
        throw "页面不存在 (404)：" + url;
      }
      throw "Invalid status code: " + res.status + " (" + url + ")";
    }
    let body = res.body ? String(res.body) : "";
    if (body.length < 400) {
      throw "Response too short: " + url;
    }
    return body;
  }

  absoluteUrl(value) {
    let url = String(value === undefined || value === null ? "" : value).trim();
    if (!url || url.indexOf("data:") === 0) {
      return "";
    }
    if (url.indexOf("//") === 0) {
      return "https:" + url;
    }
    if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) {
      return url;
    }
    return this.baseUrl + (url.charAt(0) === "/" ? url : "/" + url);
  }

  textOf(root, selector) {
    if (!root) {
      return "";
    }
    let el = root.querySelector(selector);
    return el ? String(el.text === undefined || el.text === null ? "" : el.text).trim() : "";
  }

  slugFromHref(href) {
    let match = /\/manga\/([^\/?#]+)/.exec(String(href ? href : ""));
    return match ? match[1] : "";
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
    return /^[A-Za-z0-9._-]+$/.test(decoded) ? decoded : "";
  }

  parseCard(el) {
    if (!el) {
      return null;
    }
    let link = el.querySelector("a");
    if (!link) {
      return null;
    }
    let attrs = link.attributes ? link.attributes : {};
    let href = attrs["href"] ? String(attrs["href"]) : "";
    let id = this.slugFromHref(href);
    if (!id) {
      return null;
    }
    let title = attrs["title"] ? String(attrs["title"]).trim() : "";
    if (!title) {
      title = this.textOf(el, ".tt");
    }
    if (!title) {
      title = this.textOf(el, ".nt");
    }
    let img = el.querySelector("img");
    let cover = "";
    if (img) {
      let ia = img.attributes ? img.attributes : {};
      cover = ia["data-src"] || ia["data-lazy-src"] || ia["src"] || "";
    }
    let ep = this.textOf(el, ".ep");
    return new Comic({
      id: id,
      title: title || id,
      cover: this.absoluteUrl(cover),
      subTitle: ep,
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
      if (!comic || seen[comic.id]) {
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
      let n = 0;
      let m = /\/page\/(\d+)/.exec(href);
      if (m) {
        n = parseInt(m[1], 10);
      } else {
        let m2 = /[?&]page=(\d+)/.exec(href);
        if (m2) {
          n = parseInt(m2[1], 10);
        }
      }
      if (n > max) {
        max = n;
      }
    }
    return max > 0 ? max : fallback;
  }

  chapterNumber(slug, title) {
    let num = parseInt(slug, 10);
    if (num > 0) {
      return num;
    }
    let m = /(\d+(?:\.\d+)?)/.exec(String(title || ""));
    return m ? parseFloat(m[1]) : -1;
  }

  parseEnglishDate(value) {
    let text = String(value === undefined || value === null ? "" : value).trim();
    let m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(text);
    if (!m) {
      return "";
    }
    let months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    let idx = months.indexOf(m[1].toLowerCase());
    if (idx < 0) {
      return "";
    }
    let month = idx + 1;
    let monthText = month < 10 ? "0" + month : String(month);
    let day = parseInt(m[2], 10);
    let dayText = day < 10 ? "0" + day : String(day);
    return m[3] + "-" + monthText + "-" + dayText;
  }

  // explore page list
  explore = [
    {
      title: "Hentai20",
      type: "singlePageWithMultiPart",
      load: async () => {
        let body = await this.getText(this.baseUrl + "/home1/");
        let doc = new HtmlDocument(body);
        let result = {};
        try {
          let popular = this.collectCards(doc, ".popularslider .bsx");
          if (popular.length > 0) {
            result["热门"] = popular;
          }
          let latest = this.collectCards(doc, ".listupd .imgu");
          if (latest.length > 0) {
            result["最新更新"] = latest;
          }
          let recommend = this.collectCards(doc, ".series-gen .bsx");
          if (recommend.length > 0) {
            result["推荐"] = recommend;
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
  ];

  category = {
    title: "Hentai20",
    parts: [
      {
        name: "题材",
        type: "fixed",
        itemType: "category",
        categories: [
          "全部",
          "Manhwa Hentai",
          "Manga Hentai",
          "Adventure",
          "Adult",
          "Comics",
          "Doujinshi",
          "Ecchi",
          "Gender Bender",
          "GL",
          "Hentai",
          "Historical",
          "Horror",
          "Isekai",
          "Josei",
          "Kimono",
          "Magic",
          "Manhwa",
          "Martial Arts",
          "Mystery",
          "Psychological",
          "Raw",
          "Sci-Fi",
          "Seinen",
          "Shoujo",
          "Shounen",
          "Sports",
          "Supernatural",
          "Thriller",
          "Tragedy",
          "Uncensored",
          "Yuri",
        ],
        categoryParams: [
          "all",
          "manhwa-hentai-26",
          "manga-hentai-902",
          "adventure",
          "adult",
          "comics",
          "doujinshi",
          "ecchi",
          "gender-bender",
          "gl",
          "hentai",
          "historical",
          "horror",
          "isekai",
          "josei",
          "kimono",
          "magic",
          "manhwa",
          "martial-arts",
          "mystery",
          "psychological",
          "raw",
          "sci-fi",
          "seinen",
          "shoujo",
          "shounen",
          "sports",
          "supernatural",
          "thriller",
          "tragedy",
          "uncensored",
          "yuri",
        ],
      },
    ],
    enableRankingPage: false,
  };

  categoryComics = {
    load: async (category, param, options, page) => {
      let pageNumber = parseInt(page, 10);
      if (!pageNumber || pageNumber < 1) {
        pageNumber = 1;
      }
      let slug = String(param === undefined || param === null ? "" : param).trim();
      let url;
      if (!slug || slug === "all") {
        url =
          this.baseUrl +
          "/manga/?status=&type=&order=popular&page=" +
          pageNumber;
      } else if (pageNumber === 1) {
        url = this.baseUrl + "/genres/" + encodeURIComponent(slug) + "/";
      } else {
        url =
          this.baseUrl +
          "/genres/" +
          encodeURIComponent(slug) +
          "/page/" +
          pageNumber +
          "/";
      }
      let body = await this.getText(url);
      let doc = new HtmlDocument(body);
      let comics;
      let maxPage;
      try {
        comics = this.collectCards(doc, ".listupd .bsx");
        if (comics.length === 0) {
          comics = this.collectCards(doc, ".listupd .imgu");
        }
        maxPage = this.parseMaxPage(doc, pageNumber);
      } finally {
        doc.dispose();
      }
      return { comics: comics, maxPage: maxPage };
    },
  };

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
      let url;
      if (pageNumber === 1) {
        url = this.baseUrl + "/?s=" + encodeURIComponent(word);
      } else {
        url =
          this.baseUrl +
          "/page/" +
          pageNumber +
          "/?s=" +
          encodeURIComponent(word);
      }
      let body = await this.getText(url);
      let doc = new HtmlDocument(body);
      let comics;
      let maxPage;
      try {
        comics = this.collectCards(doc, ".listupd .bsx");
        maxPage = this.parseMaxPage(doc, 1);
      } finally {
        doc.dispose();
      }
      return { comics: comics, maxPage: maxPage };
    },
    enableTagsSuggestions: false,
  };

  comic = {
    loadInfo: async (id) => {
      let comicId = this.normalizeComicId(id);
      if (!comicId) {
        throw "漫画 ID 无效: " + id;
      }
      let url = this.baseUrl + "/manga/" + comicId + "/";
      let body = await this.getText(url);
      let doc = new HtmlDocument(body);
      try {
        let title = this.textOf(doc, "h1.entry-title");
        if (!title) {
          title = this.textOf(doc, "h1");
        }
        let cover = "";
        let imgEl = doc.querySelector(".thumb img");
        if (imgEl) {
          let ia = imgEl.attributes ? imgEl.attributes : {};
          cover = this.absoluteUrl(ia["src"] || ia["data-src"] || "");
        }
        let description = this.textOf(doc, ".seriestuhead .entry-content");
        if (!description) {
          description = this.textOf(doc, ".entry-content");
        }

        let status = "";
        let updateText = "";
        let rows = doc.querySelectorAll("table.infotable tr");
        for (let i = 0; i < rows.length; i++) {
          let cells = rows[i].querySelectorAll("td");
          if (cells.length < 2) {
            continue;
          }
          let label = String(cells[0].text || "").trim().toLowerCase();
          let value = String(cells[1].text || "").trim();
          if (label.indexOf("status") >= 0 && !status) {
            status = value;
          } else if (label.indexOf("updated") >= 0 && !updateText) {
            updateText = value;
          }
        }
        let updateTime = this.parseEnglishDate(updateText);

        let chapterNodes = doc.querySelectorAll("#chapterlist li");
        let entries = [];
        for (let i = 0; i < chapterNodes.length; i++) {
          let li = chapterNodes[i];
          let link = li.querySelector("a");
          if (!link) {
            continue;
          }
          let attrs = link.attributes ? link.attributes : {};
          let href = attrs["href"] ? String(attrs["href"]) : "";
          if (!href) {
            continue;
          }
          let epSlug = href.split("?")[0].split("#")[0];
          let numberAttr = 0;
          let liAttrs = li.attributes ? li.attributes : {};
          if (liAttrs["data-num"]) {
            numberAttr = parseInt(liAttrs["data-num"], 10) || 0;
          }
          let chapterTitle = this.textOf(li, ".chapternum");
          if (!chapterTitle) {
            chapterTitle = String(link.text === undefined ? "" : link.text).trim().split("\n")[0];
          }
          entries.push({
            slug: epSlug,
            title: chapterTitle || epSlug,
            number: numberAttr > 0 ? numberAttr : this.chapterNumber("", chapterTitle),
          });
        }
        if (entries.length === 0) {
          throw "该漫画没有解析到章节: " + comicId;
        }
        entries.sort((a, b) => (a.number === b.number ? (a.slug < b.slug ? -1 : 1) : a.number - b.number));
        let chapters = new Map();
        for (let i = 0; i < entries.length; i++) {
          chapters.set(entries[i].slug, entries[i].title);
        }
        if (!updateTime) {
          let firstNode = doc.querySelector("#chapterlist .chapterdate");
          if (firstNode) {
            updateTime = this.parseEnglishDate(firstNode.text);
          }
        }

        let tags = {};
        if (status) {
          tags["状态"] = [status];
        }

        return new ComicDetails({
          title: title ? title : comicId,
          subtitle: status,
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
      let raw = "";
      if (epId === undefined || epId === null) {
        return { images: [] };
      }
      if (typeof epId === "object") {
        raw = String(epId.epId || epId.url || "");
      } else {
        raw = String(epId);
      }
      raw = raw.trim();
      if (!raw) {
        return { images: [] };
      }
      let url;
      let comicSlug = this.normalizeComicId(comicId);
      if (raw.indexOf("http://") === 0 || raw.indexOf("https://") === 0) {
        url = raw;
      } else if (raw.charAt(0) === "/") {
        url = this.baseUrl + raw;
      } else if (raw.indexOf("-chapter-") >= 0) {
        // 形如 secret-class-chapter-1（详情页章节 Map 的真实 key 形态）
        url = this.baseUrl + "/" + raw;
      } else {
        let bare = /^(?:chapter|ep)[-_]?(\d+(?:[.-]\d+)?)$/i.exec(raw);
        if (!bare || !comicSlug) {
          // 无法识别为本站章节，不发畸形请求
          return { images: [] };
        }
        // 兜底：{manga-slug}-chapter-{n}
        url = this.baseUrl + "/" + comicSlug + "-chapter-" + bare[1];
      }
      let pathPart = url.replace(/^https?:\/\/[^\/]+/, "");
      if (pathPart && pathPart.charAt(pathPart.length - 1) !== "/" && pathPart.indexOf("?") < 0) {
        url += "/";
      }
      let body = await this.getText(url);
      let images = this.extractImages(body);
      if (images.length === 0) {
        throw "章节没有图片（可能未登录/付费）：" + url;
      }
      return { images: images };
    },

    onImageLoad: (url, comicId, epId) => {
      return {
        headers: {
          "user-agent": this.userAgent,
          "referer": this.baseUrl + "/",
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

    idMatch: "hentai20\\.io/manga/([^/?#]+)",

    link: {
      domains: ["hentai20.io"],
      linkToId: (url) => {
        let m = /\/manga\/([^\/?#]+)/.exec(String(url || ""));
        return m ? m[1] : null;
      },
    },
  };

  extractImages(html) {
    let source = String(html === undefined || html === null ? "" : html);
    let urls = [];
    let re = /(https?:\/\/img\.[a-z0-9.\-]+\/[^"'\s<>\\]+?\.(?:jpg|jpeg|png|webp|gif))/gi;
    let m = re.exec(source);
    while (m !== null) {
      urls.push(m[1]);
      m = re.exec(source);
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
}
