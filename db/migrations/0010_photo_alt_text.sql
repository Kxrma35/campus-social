alter table photo_uploads
  add column alt_text text
    check (alt_text is null or (char_length(alt_text) between 1 and 500
                                and alt_text = btrim(alt_text)));

