const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function processText(rawContent, guildCache, config) {
    let content = rawContent;
    const { dictionaryRegex, readingMap } = guildCache;

    if (dictionaryRegex) {
        content = content.replace(dictionaryRegex, (matchedWord) => {
            return readingMap.get(matchedWord.toLowerCase());
        });
    }

    content = content.replace(/:[^:]+:|<[^>]+>/g, '').trim();

    if (config.read_urls === false) {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        content = content.replace(urlRegex, 'URL省略');
    }

    if (config.max_message_length && content.length > config.max_message_length) {
        content = content.substring(0, config.max_message_length) + ' 以下略';
    }

    return content;
}


module.exports = { processText, escapeRegex };
