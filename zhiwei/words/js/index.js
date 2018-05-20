(function($){

    $.fn.typer = function(options){

        var defaults = $.extend({
            search: '',
            replace: [],
            speed: 50,
            delay: 2000
        }, options);
        var txt = "你要相信你一定会变得更坚强更自信更漂亮每天都开心才能面对不开心的事情听我的没错";
        var bintext = function(length){
            var text = '';
            for(var $i = 0; $i<=length;$i++) {
                text = text + txt.charAt(Math.floor(Math.random() * txt.length))
            }
            return text;
        };

        this.each(function(){

            var $this = $(this);
            var $text = $this.data('text');
            var position = 0;
            var indexOf = $text.indexOf( defaults.search );
            var normal = $text.substr(0, indexOf);
            var changer = $text.substr(indexOf, $text.length);

            defaults.replace.push(changer);

            var interval = setInterval(function(){
                var $bintext = '';
                if( position == indexOf ) {

                    $bintext = bintext(changer.length-1);

                    $this.html( $text.substr(0, normal.length) );
                    $this.append('<span>' + $bintext + '</span>')

                } else if( position > indexOf ) {


                    $bintext = bintext($text.length-1);

                    $this.delay(defaults.speed).find('span').html(
                        changer.substring(0, position - indexOf) +
                        $bintext.substring(position, ($bintext.length))
                    );

                } else if( position < indexOf ) {

                    $bintext = bintext($text.length-1);

                    $this.delay(defaults.speed).html(
                        normal.substring(0, position) +
                        $bintext.substring(position, ($bintext.length))
                    );

                }

                if( position < changer.length ) {
                    position++;
                } else {
                    clearInterval(interval);

                    var index = 0;
                    setInterval(function(){

                        var position = 0;
                        var newText = defaults.replace[index];

                        var changeInterval = setInterval(function(){

                            var $bintext = '';
                            for(var $i = 0; $i<=newText.length-1;$i++) {
                                $bintext = $bintext + txt.charAt(Math.floor(Math.random() * txt.length))
                            }

                            $this.delay(defaults.speed).find('span').html(
                                newText.substring(0, position) +
                                $bintext.substring(position, ($bintext.length))
                            );

                            if( position < newText.length ) {
                                position++;
                            } else {
                                clearInterval(changeInterval);
                            }

                        }, defaults.speed);

                        if( index < defaults.replace.length-1 ) {
                            index++;
                        } else {
                            index = 0;
                        }
                    }, defaults.delay)


                }
            }, defaults.speed)

        });

    }



})(jQuery)

$(function(){

  $('#slogan').typer({
    search: '你要相信',
    replace: ['你一定','会变得更坚强', '更自信', '更漂亮', '每天都开心', '才能面对不开心的事情', '听我的没错']
  })
})
