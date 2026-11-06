/**
 * 肉漫天堂（rmtt5.com）— Venera comic source
 *
 * 站点事实（2026-11-06 真实响应）：
 * - 服务端渲染的 macOSVOD 系模板（vodlist / pannel / content_playlist）
 * - 首页 4 个分区：.pannel > h2.title + .cbox_list li.vodlist_item（每区 12 部）
 * - 分类：/comics-cata/{韩漫|日漫|3D漫画|真人|短篇|all}/ob/time/st/all[/page/{n}]
 * - 搜索：POST /cata.php  表单 key={关键词}（结果页 ul.vodlist.vodlist_wi）
 * - 详情：/comics-detail/{id}，章节 .content_playlist li a，href /comics-read/{id}/{token}
 * - 章节图：正文 .img-wrap img，全部位于 img.nnpic.xyz，明文 JPEG（无需 Referer）
 */
class Rmtt5 extends ComicSource {
  name = "肉漫天堂";
  key = "rmtt5";
  version = "1.0.0";
  minAppVersion = "1.0.0";
  url = "";

  baseUrl = "https://www.rmtt5.com";

  userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

  getHeaders(referer) {
    let headers = {
      "user-agent": this.userAgent,
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
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
        throw "站点返回 403（反爬/地区限制）：" + url;
      }
      if (res.status === 404) {
        throw "页面不存在 (404)：" + url;
      }
      throw "Invalid status code: " + res.status + " (" + url + ")";
    }
    let body = res.body ? String(res.body) : "";
    if (body.length < 300) {
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

  attrOf(root, selector, attr) {
    if (!root) {
      return "";
    }
    let el = root.querySelector(selector);
    if (!el) {
      return "";
    }
    let attrs = el.attributes ? el.attributes : {};
    return attrs[attr] ? String(attrs[attr]).trim() : "";
  }

  comicIdFromHref(href) {
    let m = /\/comics-detail\/(\d+)/.exec(String(href ? href : ""));
    return m ? m[1] : "";
  }

  normalizeComicId(value) {
    if (value === undefined || value === null) {
      return "";
    }
    let raw = String(value).trim();
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch (e) {
      decoded = raw;
    }
    let id = this.comicIdFromHref(decoded);
    if (id) {
      return id;
    }
    return /^\d+$/.test(decoded) ? decoded : "";
  }

  parseCard(li) {
    if (!li) {
      return null;
    }
    let link = li.querySelector("a.vodlist_thumb");
    if (!link) {
      link = li.querySelector("a");
    }
    if (!link) {
      return null;
    }
    let attrs = link.attributes ? link.attributes : {};
    let href = attrs["href"] ? String(attrs["href"]) : "";
    let id = this.comicIdFromHref(href);
    if (!id) {
      return null;
    }
    let title = attrs["title"] ? String(attrs["title"]).trim() : "";
    if (!title) {
      title = this.textOf(li, ".vodlist_titbox a");
    }
    let cover = attrs["data-original"] || attrs["data-src"] || "";
    if (!cover) {
      let img = li.querySelector("img");
      if (img) {
        let ia = img.attributes ? img.attributes : {};
        cover = ia["data-original"] || ia["data-src"] || ia["src"] || "";
      }
    }
    let subTitle = this.textOf(li, ".vodlist_sub");
    return new Comic({
      id: id,
      title: title || id,
      cover: this.absoluteUrl(cover),
      subTitle: subTitle,
      tags: [],
    });
  }

  collectItems(root, selector) {
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
    let links = doc.querySelectorAll(".page a");
    let max = 0;
    for (let i = 0; i < links.length; i++) {
      let attrs = links[i].attributes ? links[i].attributes : {};
      let href = attrs["href"] ? String(attrs["href"]) : "";
      let m = /\/page\/(\d+)/.exec(href);
      if (m) {
        let n = parseInt(m[1], 10);
        if (n > max) {
          max = n;
        }
      }
    }
    return max > 0 ? max : fallback;
  }

  chapterNumber(title) {
    let m = /第\s*(\d+(?:\.\d+)?)\s*[话話集]/.exec(String(title || ""));
    if (m) {
      return parseFloat(m[1]);
    }
    let m2 = /(\d+(?:\.\d+)?)/.exec(String(title || ""));
    return m2 ? parseFloat(m2[1]) : -1;
  }

  parseDate(text) {
    let m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(text || ""));
    if (!m) {
      return "";
    }
    let month = parseInt(m[1], 10);
    let day = parseInt(m[2], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return "";
    }
    let mt = month < 10 ? "0" + month : String(month);
    let dt = day < 10 ? "0" + day : String(day);
    return m[3] + "-" + mt + "-" + dt;
  }

  explore = [
    {
      title: "肉漫天堂",
      type: "singlePageWithMultiPart",
      load: async () => {
        let body = await this.getText(this.baseUrl + "/");
        let doc = new HtmlDocument(body);
        let result = {};
        try {
          let panels = doc.querySelectorAll(".pannel");
          for (let i = 0; i < panels.length; i++) {
            let panel = panels[i];
            let title = this.textOf(panel, "h2.title");
            title = title.replace(/^[\s\ue000-\uf8ff]+/, "").trim();
            if (!title) {
              continue;
            }
            let comics = this.collectItems(panel, "li.vodlist_item");
            if (comics.length === 0) {
              continue;
            }
            result[title] = comics;
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
    title: "肉漫天堂",
    parts: [
      {
        name: "分类",
        type: "fixed",
        itemType: "category",
        categories: ["全部", "韩漫", "日漫", "3D漫画", "真人", "短篇"],
        categoryParams: ["all", "韩漫", "日漫", "3D漫画", "真人", "短篇"],
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
      let cate = String(param === undefined || param === null ? "" : param).trim() || "all";
      let url =
        this.baseUrl +
        "/comics-cata/" +
        encodeURIComponent(cate) +
        "/ob/time/st/all";
      if (pageNumber > 1) {
        url += "/page/" + pageNumber;
      }
      let body = await this.getText(url);
      let doc = new HtmlDocument(body);
      let comics;
      let maxPage;
      try {
        comics = this.collectItems(doc, "ul.vodlist.vodlist_wi li.vodlist_item");
        if (comics.length === 0) {
          comics = this.collectItems(doc, "li.vodlist_item");
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
      let word = String(keyword === undefined || keyword === null ? "" : keyword).trim();
      if (!word) {
        return { comics: [], maxPage: 1 };
      }
      let headers = this.getHeaders(this.baseUrl + "/");
      headers["content-type"] = "application/x-www-form-urlencoded";
      let res = await Network.post(
        this.baseUrl + "/cata.php",
        headers,
        "key=" + encodeURIComponent(word)
      );
      if (!res || res.status !== 200) {
        throw "搜索失败: " + (res ? res.status : "no response");
      }
      let body = String(res.body || "");
      let doc = new HtmlDocument(body);
      let comics;
      try {
        comics = this.collectItems(doc, "ul.vodlist.vodlist_wi li.vodlist_item");
        if (comics.length === 0) {
          comics = this.collectItems(doc, "ul.vodlist li.vodlist_item");
        }
      } finally {
        doc.dispose();
      }
      return { comics: comics, maxPage: 1 };
    },
    enableTagsSuggestions: false,
  };

  comic = {
    loadInfo: async (id) => {
      let comicId = this.normalizeComicId(id);
      if (!comicId) {
        throw "漫画 ID 无效: " + id;
      }
      let url = this.baseUrl + "/comics-detail/" + comicId;
      let body = await this.getText(url);
      let doc = new HtmlDocument(body);
      try {
        let title = this.textOf(doc, "h1.title");
        if (!title) {
          title = this.textOf(doc, "h1");
        }
        let cover = this.absoluteUrl(this.attrOf(doc, ".content_thumb a", "data-original"));
        if (!cover) {
          cover = this.absoluteUrl(this.attrOf(doc, ".content_thumb img", "src"));
        }
        let infoText = this.textOf(doc, ".content_detail.content_min");
        let description = "";
        let idx = infoText.indexOf("简介：");
        if (idx >= 0) {
          description = infoText.substring(idx + 3).trim();
        } else {
          description = infoText;
        }
        let status = "";
        let topText = this.textOf(doc, ".content_detail.content_top");
        if (topText.indexOf("连载中") >= 0) {
          status = "连载中";
        } else if (topText.indexOf("已完结") >= 0 || topText.indexOf("已完結") >= 0) {
          status = "已完结";
        }
        let updateTime = this.parseDate(topText);

        let genres = [];
        let seenGenre = {};
        let links = doc.querySelectorAll(".content_min a");
        for (let i = 0; i < links.length; i++) {
          let attrs = links[i].attributes ? links[i].attributes : {};
          let href = attrs["href"] ? String(attrs["href"]) : "";
          if (href.indexOf("/comics-cata/") !== 0) {
            continue;
          }
          let name = String(links[i].text === undefined ? "" : links[i].text).trim();
          if (!name || seenGenre[name]) {
            continue;
          }
          seenGenre[name] = true;
          genres.push(name);
        }

        let chapterNodes = doc.querySelectorAll(".content_playlist li a");
        let entries = [];
        let usedTitles = {};
        for (let i = 0; i < chapterNodes.length; i++) {
          let attrs = chapterNodes[i].attributes ? chapterNodes[i].attributes : {};
          let href = attrs["href"] ? String(attrs["href"]) : "";
          if (href.indexOf("/comics-read/") !== 0) {
            continue;
          }
          let chapterTitle = String(chapterNodes[i].text === undefined ? "" : chapterNodes[i].text).trim();
          if (!chapterTitle) {
            chapterTitle = attrs["title"] ? String(attrs["title"]).trim() : href;
          }
          if (usedTitles[chapterTitle]) {
            continue;
          }
          usedTitles[chapterTitle] = true;
          entries.push({
            slug: href,
            title: chapterTitle,
            number: this.chapterNumber(chapterTitle),
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

        let tags = {};
        if (status) {
          tags["状态"] = [status];
        }
        if (genres.length > 0) {
          tags["分类"] = genres;
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
      let comic = this.normalizeComicId(comicId);
      let url;
      if (raw.indexOf("http://") === 0 || raw.indexOf("https://") === 0) {
        url = raw;
      } else if (raw.charAt(0) === "/") {
        url = this.baseUrl + raw;
      } else if (/^\d+\/[A-Za-z0-9]+$/.test(raw)) {
        url = this.baseUrl + "/comics-read/" + raw;
      } else if (comic && /^[A-Za-z0-9]+$/.test(raw)) {
        url = this.baseUrl + "/comics-read/" + comic + "/" + raw;
      } else {
        return { images: [] };
      }
      let body = await this.getText(url);
      let images = this.extractImages(body);
      if (images.length === 0) {
        throw "章节没有图片：" + url;
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

    link: {
      domains: ["rmtt5.com", "www.rmtt5.com"],
      linkToId: (url) => {
        let m = /\/comics-detail\/(\d+)/.exec(String(url || ""));
        return m ? m[1] : null;
      },
    },
  };

  extractImages(html) {
    let source = String(html === undefined || html === null ? "" : html);
    let urls = [];
    let seen = {};
    let doc = new HtmlDocument(source);
    try {
      let nodes = doc.querySelectorAll(".img-wrap img");
      for (let i = 0; i < nodes.length; i++) {
        let attrs = nodes[i].attributes ? nodes[i].attributes : {};
        let src = attrs["data-src"] || attrs["data-original"] || attrs["src"] || "";
        let url = this.absoluteUrl(src);
        if (url && !seen[url] && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)) {
          seen[url] = true;
          urls.push(url);
        }
      }
    } finally {
      doc.dispose();
    }
    if (urls.length === 0) {
      let re = /(https?:\/\/img\.[a-z0-9.\-]+\/[^"'\s<>\\]+?\.(?:jpg|jpeg|png|webp|gif))/gi;
      let m = re.exec(source);
      while (m !== null) {
        if (!seen[m[1]]) {
          seen[m[1]] = true;
          urls.push(m[1]);
        }
        m = re.exec(source);
      }
    }
    return urls;
  }
}
